import { describe, it, expect } from 'vitest';
import { extractIconLinks, extractManifestHref } from '../origin.js';

const html = `
<html><head>
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example.com/at.png">
<link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/site.webmanifest">
</head></html>`;

describe('extractIconLinks', () => {
  it('returns only icon-rel links with their href and rel', () => {
    expect(extractIconLinks(html)).toEqual([
      { href: '/favicon.ico', rel: 'icon' },
      { href: 'https://cdn.example.com/at.png', rel: 'apple-touch-icon' },
    ]);
  });

  it('returns an empty array when there are no icon links', () => {
    expect(extractIconLinks('<head></head>')).toEqual([]);
  });
});

describe('extractManifestHref', () => {
  it('returns the manifest href', () => {
    expect(extractManifestHref(html)).toBe('/site.webmanifest');
  });

  it('returns null when no manifest link is present', () => {
    expect(extractManifestHref('<head></head>')).toBeNull();
  });
});
