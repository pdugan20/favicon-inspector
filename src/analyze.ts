import { decode as decodePng } from 'fast-png';
import * as jpeg from 'jpeg-js';

export type ImageFormat = 'png' | 'jpeg' | 'ico' | 'svg' | 'unknown';

export type CornerClass =
  | 'TRANSPARENT'
  | 'OPAQUE-WHITE'
  | 'OPAQUE-BLACK'
  | `OPAQUE-OTHER(${string})`
  | 'UNDECODED';

export type Verdict = 'OK' | 'WARN' | 'ALERT';

export interface Analysis {
  format: ImageFormat;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  cornerClass: CornerClass;
  verdict: Verdict;
}

export function sniffFormat(bytes: Uint8Array): ImageFormat {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return 'ico';
  }
  const head = new TextDecoder().decode(bytes.slice(0, 256)).toLowerCase();
  if (
    head.includes('<svg') ||
    (head.includes('<?xml') && head.includes('svg'))
  ) {
    return 'svg';
  }
  return 'unknown';
}

export interface Rgba {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const ALPHA_OPAQUE_MIN = 16;
const DARK_MAX = 16;
const LIGHT_MIN = 240;

function cornerPixel(
  img: Rgba,
  x: number,
  y: number
): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function classifyCorners(img: Rgba): CornerClass {
  const pts: [number, number][] = [
    [0, 0],
    [img.width - 1, 0],
    [0, img.height - 1],
    [img.width - 1, img.height - 1],
  ];
  const corners = pts.map(([x, y]) => cornerPixel(img, x, y));
  const maxAlpha = Math.max(...corners.map((c) => c[3]));
  if (maxAlpha < ALPHA_OPAQUE_MIN) return 'TRANSPARENT';

  const opaque = corners.filter((c) => c[3] >= ALPHA_OPAQUE_MIN);
  const allDark = opaque.every(
    (c) => c[0] <= DARK_MAX && c[1] <= DARK_MAX && c[2] <= DARK_MAX
  );
  if (allDark) return 'OPAQUE-BLACK';

  const allLight = opaque.every(
    (c) => c[0] >= LIGHT_MIN && c[1] >= LIGHT_MIN && c[2] >= LIGHT_MIN
  );
  if (allLight) return 'OPAQUE-WHITE';

  const [r, g, b] = opaque[0];
  const hex =
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `OPAQUE-OTHER(${hex})`;
}

export function verdictFor(
  format: ImageFormat,
  cornerClass: CornerClass,
  expected?: 'transparent' | 'opaque'
): Verdict {
  if (format === 'jpeg') {
    if (cornerClass === 'OPAQUE-BLACK' && expected !== 'opaque') return 'ALERT';
    return 'WARN';
  }
  return 'OK';
}

/**
 * Decode PNG/JPEG bytes to a uniform 8-bit RGBA buffer. Assumes 8-bit PNG
 * depth (true for favicons). Returns null for formats we do not decode
 * (ico, svg, unknown).
 */
export function decodeToRgba(
  bytes: Uint8Array,
  format: ImageFormat
): (Rgba & { hasAlpha: boolean }) | null {
  if (format === 'png') {
    const img = decodePng(bytes);
    const { width, height, channels } = img;
    const src = img.data as Uint8Array;
    const out = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      let r: number;
      let g: number;
      let b: number;
      let a: number;
      if (channels === 4) {
        r = src[p * 4];
        g = src[p * 4 + 1];
        b = src[p * 4 + 2];
        a = src[p * 4 + 3];
      } else if (channels === 3) {
        r = src[p * 3];
        g = src[p * 3 + 1];
        b = src[p * 3 + 2];
        a = 255;
      } else if (channels === 2) {
        r = g = b = src[p * 2];
        a = src[p * 2 + 1];
      } else {
        r = g = b = src[p];
        a = 255;
      }
      out[p * 4] = r;
      out[p * 4 + 1] = g;
      out[p * 4 + 2] = b;
      out[p * 4 + 3] = a;
    }
    return {
      width,
      height,
      data: out,
      hasAlpha: channels === 4 || channels === 2,
    };
  }
  if (format === 'jpeg') {
    const img = jpeg.decode(bytes, { useTArray: true });
    return {
      width: img.width,
      height: img.height,
      data: img.data as unknown as Uint8Array,
      hasAlpha: false,
    };
  }
  return null;
}

export function analyzeImage(
  bytes: Uint8Array,
  opts: { expected?: 'transparent' | 'opaque' } = {}
): Analysis {
  const format = sniffFormat(bytes);
  let width: number | undefined;
  let height: number | undefined;
  let hasAlpha: boolean | undefined;
  let cornerClass: CornerClass = 'UNDECODED';
  try {
    const img = decodeToRgba(bytes, format);
    if (img) {
      width = img.width;
      height = img.height;
      hasAlpha = img.hasAlpha;
      cornerClass = classifyCorners(img);
    }
  } catch {
    cornerClass = 'UNDECODED';
  }
  const verdict = verdictFor(format, cornerClass, opts.expected);
  return { format, width, height, hasAlpha, cornerClass, verdict };
}
