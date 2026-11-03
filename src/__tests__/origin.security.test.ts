import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ resource: vi.fn(), image: vi.fn() }));
vi.mock('../fetch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../fetch.js')>()),
  fetchResource: mocks.resource,
  fetchImage: mocks.image,
}));
import { probeOrigin } from '../origin.js';
import { MAX_DOCUMENT_BYTES, MAX_ORIGIN_ICONS } from '../config.js';
beforeEach(() => {
  mocks.resource.mockReset();
  mocks.image
    .mockReset()
    .mockResolvedValue({ status: 404, contentType: null, bytes: null });
});
describe('bounded origin discovery', () => {
  it('uses bounded fetches and final redirect bases for HTML and manifests', async () => {
    mocks.resource
      .mockResolvedValueOnce({
        url: 'https://example.com/moved/',
        bytes: Buffer.from(
          '<link rel="icon" href="icon.png"><link rel="manifest" href="site.json">'
        ),
      })
      .mockResolvedValueOnce({
        url: 'https://cdn.example.com/app/site.json',
        bytes: Buffer.from('{"icons":[{"src":"icons/app.png"}]}'),
      });
    await probeOrigin('example.com');
    expect(mocks.resource).toHaveBeenNthCalledWith(
      1,
      'https://example.com/',
      undefined,
      MAX_DOCUMENT_BYTES
    );
    expect(mocks.resource).toHaveBeenNthCalledWith(
      2,
      'https://example.com/moved/site.json',
      undefined,
      MAX_DOCUMENT_BYTES
    );
    expect(mocks.image).toHaveBeenCalledWith(
      'https://example.com/moved/icon.png'
    );
    expect(mocks.image).toHaveBeenCalledWith(
      'https://cdn.example.com/app/icons/app.png'
    );
  });
  it('caps attacker-controlled icon fanout', async () => {
    mocks.resource.mockResolvedValueOnce({
      url: 'https://example.com/',
      bytes: Buffer.from(
        Array.from(
          { length: 1000 },
          (_, i) => `<link rel="icon" href="/${i}.png">`
        ).join('')
      ),
    });
    await probeOrigin('example.com');
    expect(mocks.image).toHaveBeenCalledTimes(4 + MAX_ORIGIN_ICONS);
  });
  it('falls back to bounded well-known probes when a document is rejected', async () => {
    mocks.resource.mockResolvedValueOnce({
      url: 'https://example.com/',
      bytes: null,
      error: 'deadline',
    });
    await probeOrigin('example.com');
    expect(mocks.image).toHaveBeenCalledTimes(4);
  });
  it('counts unique resolved URLs instead of duplicate declarations', async () => {
    mocks.resource
      .mockResolvedValueOnce({
        url: 'https://example.com/',
        bytes: Buffer.from(
          '<link rel="icon" href="/duplicate.png">'.repeat(32) +
            '<link rel="icon" href="/real.png"><link rel="manifest" href="/site.json">'
        ),
      })
      .mockResolvedValueOnce({
        url: 'https://example.com/site.json',
        bytes: Buffer.from(
          JSON.stringify({
            icons: [
              ...Array.from({ length: 32 }, () => ({ src: '/duplicate.png' })),
              { src: '/manifest.png' },
            ],
          })
        ),
      });
    await probeOrigin('example.com');
    expect(mocks.image).toHaveBeenCalledWith('https://example.com/real.png');
    expect(mocks.image).toHaveBeenCalledWith(
      'https://example.com/manifest.png'
    );
    expect(mocks.image).toHaveBeenCalledTimes(7);
  });
  it('parses unterminated link-tag floods within a bounded child-process deadline', () => {
    const script =
      "import { extractIconLinks, extractManifestHref } from './src/origin.ts'; const html='<link '.repeat(300000); if(extractIconLinks(html).length || extractManifestHref(html)!==null) process.exit(1);";
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { timeout: 5000, encoding: 'utf8' }
    );
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(0);
  }, 10000);
});
