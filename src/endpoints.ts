import type { Endpoint } from './config';

export function buildGoogleUrl(
  endpoint: Endpoint,
  domain: string,
  size: number
): string {
  if (endpoint === 'faviconV2') {
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=${size}`;
  }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}
