import { lookup } from 'node:dns/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { BlockList, isIP } from 'node:net';
import {
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_REDIRECTS,
} from './config.js';

export interface FetchResult {
  url: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array | null;
  error?: string;
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
blocked.addSubnet('3ffe::', 16, 'ipv6');
blocked.addSubnet('3fff::', 20, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // Exclude mapped, translated, tunnelling and non-global IPv6 addresses.
  return (
    family === 6 &&
    globalV6.check(address, 'ipv6') &&
    !blocked.check(address, 'ipv6')
  );
}

function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Only credential-free HTTP(S) URLs are allowed');
  }
  return url;
}

interface ResponseBytes {
  url: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
  location?: string;
}

// OS lookups preserve /etc/hosts and split DNS. Active getaddrinfo calls cannot
// be cancelled, so keep at most two outstanding even after callers time out.
let activeLookups = 0;
const lookupWaiters: {
  signal: AbortSignal;
  ready: () => void;
  abort: () => void;
}[] = [];
function acquireLookup(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  if (activeLookups < 2) {
    activeLookups++;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = {
      signal,
      ready: resolve,
      abort: () => {
        const index = lookupWaiters.indexOf(waiter);
        if (index >= 0) lookupWaiters.splice(index, 1);
        reject(signal.reason);
      },
    };
    lookupWaiters.push(waiter);
    signal.addEventListener('abort', waiter.abort, { once: true });
  });
}
function releaseLookup() {
  activeLookups--;
  const waiter = lookupWaiters.shift();
  if (waiter) {
    waiter.signal.removeEventListener('abort', waiter.abort);
    activeLookups++;
    waiter.ready();
  }
}
async function resolveAddresses(hostname: string, signal: AbortSignal) {
  await acquireLookup(signal);
  try {
    signal.throwIfAborted();
    return await lookup(hostname, { all: true });
  } finally {
    releaseLookup();
  }
}

async function requestOnce(
  url: URL,
  signal: AbortSignal,
  maxBytes: number
): Promise<ResponseBytes> {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family
    ? [{ address: hostname, family }]
    : await resolveAddresses(hostname, signal);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new Error(
      'Destination must resolve only to public network addresses'
    );
  }
  signal.throwIfAborted();
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const get = url.protocol === 'https:' ? httpsGet : httpGet;
    const req = get(
      url,
      {
        agent: false,
        signal,
        maxHeaderSize: 16 * 1024,
        headers: { 'Accept-Encoding': 'identity' },
        // Pin the vetted result, retaining the URL hostname for Host and TLS verification.
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, selected.address, selected.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = res.headers['content-type'] ?? null;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          res.headers.location
        ) {
          resolve({
            url: url.href,
            status,
            contentType,
            bytes: new Uint8Array(),
            location: res.headers.location,
          });
          res.destroy();
          return;
        }
        const encoding = res.headers['content-encoding'];
        if (encoding && encoding !== 'identity') {
          res.destroy();
          reject(new Error('Compressed HTTP responses are not supported'));
          return;
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          res.destroy();
          reject(new Error('Response exceeds byte limit'));
          return;
        }
        let storage = Buffer.allocUnsafe(Math.min(maxBytes, 64 * 1024));
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new Error('Response exceeds byte limit'));
          } else {
            if (size > storage.length) {
              const grown = Buffer.allocUnsafe(
                Math.min(maxBytes, Math.max(size, storage.length * 2))
              );
              storage.copy(grown, 0, 0, size - chunk.length);
              storage = grown;
            }
            chunk.copy(storage, size - chunk.length);
          }
        });
        res.once('error', reject);
        res.once('aborted', () => reject(new Error('Response interrupted')));
        res.once('end', () =>
          resolve({
            url: url.href,
            status,
            contentType,
            bytes: Uint8Array.from(storage.subarray(0, size)),
          })
        );
      }
    );
    req.once('error', reject);
  });
}

/** A single deadline covers DNS, all redirects, headers, and streamed body bytes. */
export async function fetchResource(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS,
  maxBytes = MAX_RESPONSE_BYTES
): Promise<FetchResult> {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0
    ) {
      throw new Error('Fetch limits must be positive finite values');
    }
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('Fetch deadline exceeded');
        ctrl.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const follow = async (): Promise<FetchResult> => {
      let current = checkedUrl(url);
      for (let redirects = 0; ; redirects++) {
        const result = await requestOnce(current, ctrl.signal, maxBytes);
        if (!result.location) return result;
        if (redirects >= MAX_REDIRECTS)
          throw new Error('Redirect limit exceeded');
        const next = checkedUrl(new URL(result.location, current).href);
        if (current.protocol === 'https:' && next.protocol !== 'https:')
          throw new Error('HTTPS downgrade redirect rejected');
        current = next;
      }
    };
    return await Promise.race([follow(), timeout]);
  } catch (error) {
    return {
      url,
      status: 0,
      contentType: null,
      bytes: null,
      error: (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function fetchImage(
  url: string,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<FetchResult> {
  return fetchResource(url, timeoutMs);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}
