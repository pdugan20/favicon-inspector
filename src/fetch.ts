import { FETCH_TIMEOUT_MS } from './config';

export interface FetchResult {
  url: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array | null;
  error?: string;
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
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

export async function fetchImage(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      contentType: null,
      bytes: null,
      error: (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
