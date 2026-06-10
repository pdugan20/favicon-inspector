export const ENDPOINTS = ['faviconV2', 's2'] as const;
export type Endpoint = (typeof ENDPOINTS)[number];

export interface DomainConfig {
  /** Bare apex host, e.g. 'rewind.rest'. */
  domain: string;
  /** Mark domains whose icon is legitimately an opaque tile. */
  expected?: 'transparent' | 'opaque';
}

export const SIZES = [16, 32, 48, 64, 96, 128, 256] as const;

export const CONCURRENCY = 8;
export const FETCH_TIMEOUT_MS = 10000;
