/** Real loopback transport fixtures; public-address policy is tested separately. */
import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ cert: Buffer.alloc(0) }));
// Permit only our loopback fixture at the policy boundary, while exercising the
// actual Node request, socket lookup, Host, TLS verification, and cancellation.
vi.mock('node:net', async (original) => ({
  ...(await original<typeof import('node:net')>()),
  BlockList: class {
    addSubnet() {}
    check() {
      return false;
    }
  },
}));
vi.mock('node:dns/promises', () => ({
  Resolver: class {
    async resolve4() {
      return ['127.0.0.1'];
    }
    async resolve6() {
      return [];
    }
    cancel() {}
  },
}));
vi.mock('node:https', async (original) => {
  const https = await original<typeof import('node:https')>();
  return {
    ...https,
    get: (
      url: URL,
      options: RequestOptions,
      callback: (res: IncomingMessage) => void
    ) => https.get(url, { ...options, ca: fixture.cert }, callback),
  };
});
import { fetchResource } from '../fetch.js';
let directory: string;
let key: Buffer;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'favicon-test-tls-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-subj',
      '/CN=example.test',
      '-addext',
      'subjectAltName=DNS:example.test',
      '-days',
      '1',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
    ],
    { stdio: 'ignore' }
  );
  key = readFileSync(join(directory, 'key.pem'));
  fixture.cert = readFileSync(join(directory, 'cert.pem'));
});
afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('real bounded sockets', () => {
  it('uses the original DNS hostname for Host, SNI, and certificate identity', async () => {
    let host: string | undefined;
    let sni: string | false | null | undefined;
    const server = httpsServer(
      { key, cert: fixture.cert },
      (request, response) => {
        host = request.headers.host;
        response.end('icon');
      }
    );
    server.on('secureConnection', (socket) => {
      sni = socket.servername;
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    try {
      const result = await fetchResource(
        `https://example.test:${address.port}/icon`
      );
      expect(result.status).toBe(200);
      expect(host).toBe(`example.test:${address.port}`);
      expect(sni).toBe('example.test');
      const wrong = await fetchResource(
        `https://other.test:${address.port}/icon`
      );
      expect(wrong.status).toBe(0);
      expect(wrong.error).toMatch(/certificate|altname|Hostname/i);
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });
  it('aborts a real pre-header socket when the deadline expires', async () => {
    const server = httpServer(() => {});
    let closed = false;
    server.on('connection', (socket) =>
      socket.once('close', () => {
        closed = true;
      })
    );
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    try {
      const result = await fetchResource(
        `http://127.0.0.1:${address.port}/`,
        50
      );
      expect(result.status).toBe(0);
      await vi.waitFor(() => expect(closed).toBe(true));
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });
  it('rejects actual over-limit headers and truncated bodies', async () => {
    const server = httpServer((request, response) => {
      if (request.url === '/headers')
        response.writeHead(200, { 'X-Oversize': 'x'.repeat(20 * 1024) }).end();
      else {
        response.writeHead(200, { 'Content-Length': 20 });
        response.write('short');
        response.socket?.destroy();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No test port');
    try {
      expect(
        (await fetchResource(`http://127.0.0.1:${address.port}/headers`)).status
      ).toBe(0);
      expect(
        (await fetchResource(`http://127.0.0.1:${address.port}/truncated`))
          .bytes
      ).toBeNull();
    } finally {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
    }
  });
});
