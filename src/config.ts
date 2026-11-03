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
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const MAX_ORIGIN_ICONS = 32;
export const MAX_IMAGE_PIXELS = 4_000_000;
export const MAX_PNG_CHUNKS = 4096;

/**
 * Perceptual-hash Hamming distance (0..64) at/above which a Google cell is
 * treated as a different image from the origin master (see divergence.ts).
 * Calibrated so same-art drift (<=~11) passes and wrong-logo drift (~35) trips.
 */
export const DIVERGENCE_THRESHOLD = 20;
