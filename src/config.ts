export type Endpoint = 'faviconV2' | 's2';

export interface DomainConfig {
  /** Bare apex host, e.g. 'rewind.rest'. */
  domain: string;
  /** Mark domains whose icon is legitimately an opaque tile. */
  expected?: 'transparent' | 'opaque';
}

export const DOMAINS: DomainConfig[] = [
  { domain: 'rewind.rest' },
  { domain: 'getbiblio.app' },
  { domain: 'next-up.app' },
  { domain: 'patdugan.me' },
  { domain: 'clickwheel.fm' },
];

export const SIZES = [16, 32, 48, 64, 96, 128, 256] as const;

export const ENDPOINTS: Endpoint[] = ['faviconV2', 's2'];

export const CONCURRENCY = 8;
export const FETCH_TIMEOUT_MS = 10000;
