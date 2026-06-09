import { describe, it, expect } from 'vitest';
import { buildGoogleUrl } from '../endpoints';

describe('buildGoogleUrl', () => {
  it('builds a faviconV2 URL with https-prefixed domain and size', () => {
    const url = buildGoogleUrl('faviconV2', 'rewind.rest', 64);
    expect(url).toBe(
      'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://rewind.rest&size=64'
    );
  });

  it('builds a legacy s2 URL with bare domain and sz param', () => {
    const url = buildGoogleUrl('s2', 'rewind.rest', 48);
    expect(url).toBe(
      'https://www.google.com/s2/favicons?domain=rewind.rest&sz=48'
    );
  });
});
