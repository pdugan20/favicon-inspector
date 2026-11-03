import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), get: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:http', () => ({ get: mocks.get }));
vi.mock('node:https', () => ({ get: mocks.get }));
import { fetchImage, fetchResource, isPublicAddress } from '../fetch.js';
import { MAX_REDIRECTS } from '../config.js';

function response(
  status = 200,
  body: string | Buffer = 'icon',
  headers: Record<string, string> = {}
) {
  mocks.get.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter();
    queueMicrotask(() => {
      const res = Object.assign(Readable.from([Buffer.from(body)]), {
        statusCode: status,
        headers,
      });
      options.signal.addEventListener(
        'abort',
        () => res.destroy(options.signal.reason),
        { once: true }
      );
      callback(res);
    });
    return req;
  });
}
beforeEach(() => {
  mocks.lookup
    .mockReset()
    .mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mocks.get.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('bounded public HTTP fetching', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '192.168.1.1',
    '0.0.0.0',
    '224.1.1.1',
    '::1',
    'fe80::1',
    'fc00::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '2002:7f00:1::',
    '2001:db8::1',
  ])('rejects special address %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'])(
    'permits public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );
  it.each([
    'file:///etc/passwd',
    'data:text/plain,secret',
    'https://user:secret@example.com/icon',
    'http://2130706433/icon',
    'http://[::ffff:7f00:1]/icon',
  ])('rejects unsafe URL %s before connecting', async (url) => {
    expect((await fetchImage(url)).status).toBe(0);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('rejects mixed public/private DNS answers before opening a socket', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    expect((await fetchImage('https://example.com/icon')).error).toMatch(
      /public/
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('pins validated DNS answers while preserving URL hostname for Host/TLS', async () => {
    response();
    const result = await fetchImage('https://example.com/icon');
    expect(result.bytes).toEqual(new Uint8Array(Buffer.from('icon')));
    const [url, options] = mocks.get.mock.calls[0];
    expect(url.hostname).toBe('example.com');
    expect(options.agent).toBe(false);
    const callback = vi.fn();
    options.lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '93.184.216.34', family: 4 },
    ]);
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
  it('rejects a redirect to private services before a second connection', async () => {
    response(302, '', { location: 'http://127.0.0.1/admin' });
    expect((await fetchImage('http://example.com/icon')).status).toBe(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('checks DNS again on redirects to a rebinding hostname', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    response(302, '', { location: '/next' });
    expect((await fetchImage('https://example.com/icon')).error).toMatch(
      /public/
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('follows bounded public redirects and returns the final document base', async () => {
    response(302, '', { location: '/moved/' });
    response(200, 'ok');
    const r = await fetchResource('https://example.com/');
    expect(r.url).toBe('https://example.com/moved/');
    expect(r.status).toBe(200);
  });
  it('bounds redirect loops', async () => {
    for (let i = 0; i <= MAX_REDIRECTS; i++)
      response(302, '', { location: '/again' });
    expect((await fetchImage('https://example.com/')).error).toMatch(
      /Redirect limit/
    );
    expect(mocks.get).toHaveBeenCalledTimes(MAX_REDIRECTS + 1);
  });
  it('rejects advertised and streamed oversize bodies without returning bytes', async () => {
    response(200, 'small', { 'content-length': '100' });
    expect(
      (await fetchResource('https://example.com/', 1000, 4)).bytes
    ).toBeNull();
    response(200, 'oversized');
    expect(
      (await fetchResource('https://example.com/', 1000, 4)).error
    ).toMatch(/byte limit/);
  });
  it('has a deadline even if DNS never completes', async () => {
    vi.useFakeTimers();
    let complete!: (value: { address: string; family: number }[]) => void;
    mocks.lookup.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    const result = fetchResource('https://example.com/', 10);
    await vi.advanceTimersByTimeAsync(11);
    expect((await result).error).toMatch(/deadline/);
    complete([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('keeps a stalled body under the same deadline', async () => {
    vi.useFakeTimers();
    mocks.get.mockImplementationOnce((_url, options, callback) => {
      const req = new EventEmitter();
      queueMicrotask(() => {
        const res = Object.assign(new Readable({ read() {} }), {
          statusCode: 200,
          headers: {},
        });
        options.signal.addEventListener(
          'abort',
          () => res.destroy(options.signal.reason),
          { once: true }
        );
        callback(res);
      });
      return req;
    });
    const result = fetchResource('https://example.com/', 10);
    await vi.advanceTimersByTimeAsync(11);
    expect((await result).bytes).toBeNull();
  });
  it('coalesces many tiny body chunks without changing the payload', async () => {
    mocks.get.mockImplementationOnce((_url, _options, callback) => {
      const req = new EventEmitter();
      queueMicrotask(() =>
        callback(
          Object.assign(
            Readable.from(
              Array.from({ length: 100_000 }, () => Buffer.from('x'))
            ),
            { statusCode: 200, headers: {} }
          )
        )
      );
      return req;
    });
    const r = await fetchResource('https://example.com/');
    expect(r.bytes?.length).toBe(100_000);
    expect(r.bytes?.every((byte) => byte === 120)).toBe(true);
  });
  it('rejects HTTPS downgrade redirects', async () => {
    response(302, '', { location: 'http://example.com/icon' });
    expect((await fetchImage('https://example.com/icon')).error).toMatch(
      /downgrade/
    );
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it('retains all vetted families for socket fallback without resolving again', async () => {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    response();
    await fetchImage('https://example.com/icon');
    const options = mocks.get.mock.calls[0][1];
    const callback = vi.fn();
    options.lookup('example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
    const single = vi.fn();
    options.lookup('example.com', {}, single);
    expect(single).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });
  it('bounds outstanding system lookups even after many callers expire', async () => {
    vi.useFakeTimers();
    const pending: ((value: { address: string; family: number }[]) => void)[] =
      [];
    mocks.lookup.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve))
    );
    const results = Array.from({ length: 100 }, () =>
      fetchResource('https://example.com/', 10)
    );
    await vi.advanceTimersByTimeAsync(11);
    expect(
      (await Promise.all(results)).every((result) => result.status === 0)
    ).toBe(true);
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
    pending.forEach((resolve) =>
      resolve([{ address: '93.184.216.34', family: 4 }])
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.get).not.toHaveBeenCalled();
    mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    response();
    expect((await fetchResource('https://example.com/')).status).toBe(200);
  });
});
