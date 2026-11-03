import { inflateSync } from 'node:zlib';
import {
  MAX_IMAGE_PIXELS,
  MAX_RESPONSE_BYTES,
  MAX_PNG_CHUNKS,
} from './config.js';
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

/**
 * Pull intrinsic dimensions from an SVG: explicit width/height attributes
 * (ignoring percentage units), else the viewBox extents. Used to flag
 * non-square vector masters that Google stretches into a square box.
 */
export function svgDimensions(bytes: Uint8Array): {
  width?: number;
  height?: number;
} {
  const head = new TextDecoder().decode(bytes.slice(0, 1024));
  const tag = /<svg\b[^>]*>/i.exec(head)?.[0];
  if (!tag) return {};
  const attr = (name: string): number | undefined => {
    const m = new RegExp(`\\b${name}\\s*=\\s*["']?\\s*([\\d.]+)(%)?`, 'i').exec(
      tag
    );
    if (!m || m[2] === '%') return undefined; // ignore relative units
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const width = attr('width');
  const height = attr('height');
  if (width && height) return { width, height };
  const vb = /\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i
    .exec(tag)
    ?.slice(1, 3)
    .map(Number);
  if (vb && vb[0] > 0 && vb[1] > 0) return { width: vb[0], height: vb[1] };
  return {};
}

/** Bound decoder input and reject compressed or embedded resource amplification. */
export function boundedImageInput(bytes: Uint8Array): Uint8Array {
  if (bytes.length > MAX_RESPONSE_BYTES)
    throw new Error('Image exceeds byte limit');
  if (sniffFormat(bytes) === 'svg') {
    const svg = new TextDecoder().decode(bytes);
    // Only resource-free vectors: librsvg's outer pixel cap does not constrain
    // embedded images/fonts. Reject entities and CSS escapes as obfuscation paths.
    if (
      /<!DOCTYPE|<!ENTITY|<(?:[^<>\s/]+:)?(?:image|feImage|foreignObject|script)\b|@import|@font-face|[&\\]/i.test(
        svg
      )
    )
      throw new Error('SVG embedded resources are not supported');
    for (const match of svg.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gis)) {
      if (!/^#[A-Za-z0-9_.:-]+$/.test(match[2]))
        throw new Error('SVG external references are not supported');
    }
    const urls = /url\s*\(/gi;
    for (let match = urls.exec(svg); match; match = urls.exec(svg)) {
      const end = svg.indexOf(')', urls.lastIndex);
      if (end < 0) throw new Error('Invalid SVG resource reference');
      const value = svg
        .slice(urls.lastIndex, end)
        .trim()
        .replace(/^(["'])(.*)\1$/, '$2');
      if (!/^#[A-Za-z0-9_.:-]+$/.test(value))
        throw new Error('SVG external references are not supported');
      urls.lastIndex = end + 1;
    }
    return bytes;
  }
  if (sniffFormat(bytes) !== 'png') return bytes;
  const input = Buffer.from(bytes);
  if (
    input.length < 33 ||
    input.toString('latin1', 12, 16) !== 'IHDR' ||
    input.readUInt32BE(8) !== 13
  )
    throw new Error('Invalid PNG header');
  const width = input.readUInt32BE(16);
  const height = input.readUInt32BE(20);
  if (!width || !height || width * height > MAX_IMAGE_PIXELS)
    throw new Error('Image exceeds pixel limit');
  const chunks: Buffer[] = [input.subarray(0, 8)];
  const data: Buffer[] = [];
  let ended = false;
  let chunkCount = 0;
  for (let offset = 8; offset + 12 <= input.length;) {
    if (++chunkCount > MAX_PNG_CHUNKS)
      throw new Error('PNG chunk limit exceeded');
    const length = input.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > input.length) throw new Error('Truncated PNG chunk');
    const type = input.toString('latin1', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid PNG chunk type');
    if (type === 'IHDR' && offset !== 8)
      throw new Error('Duplicate PNG header');
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type))
      chunks.push(input.subarray(offset, end));
    if (type === 'IDAT') data.push(input.subarray(offset + 8, end - 4));
    if (type === 'IEND') {
      ended = true;
      break;
    }
    offset = end;
  }
  if (!ended || !data.length) throw new Error('Incomplete PNG');
  // At most RGBA16 plus Adam7 row-filter overhead. Corrupt small-header bombs
  // cannot ask fflate to expand an arbitrarily large stream afterwards.
  inflateSync(Buffer.concat(data), {
    maxOutputLength: width * height * 8 + height * 7 + 64,
  });
  return Buffer.concat(chunks);
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
    const img = decodePng(boundedImageInput(bytes));
    const { width, height, channels } = img;
    const src = img.data as Uint8Array;
    const palette = (img as { palette?: number[][] }).palette;
    const out = new Uint8Array(width * height * 4);

    // Indexed-color PNG: `src` holds palette indices, not colors. Map each
    // index through the palette (entries are [r,g,b] or [r,g,b,a]). Without
    // this, a transparent palette entry at index 0 reads as opaque black.
    if (palette) {
      const hasAlpha = palette.some((e) => e.length > 3 && e[3] < 255);
      for (let p = 0; p < width * height; p++) {
        const entry = palette[src[p]] ?? [0, 0, 0, 0];
        out[p * 4] = entry[0];
        out[p * 4 + 1] = entry[1];
        out[p * 4 + 2] = entry[2];
        out[p * 4 + 3] = entry.length > 3 ? entry[3] : 255;
      }
      return { width, height, data: out, hasAlpha };
    }

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
    boundedImageInput(bytes);
    const img = jpeg.decode(bytes, {
      useTArray: true,
      maxResolutionInMP: MAX_IMAGE_PIXELS / 1_000_000,
      maxMemoryUsageInMB: 64,
    });
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
  if (format === 'svg') {
    const dims = svgDimensions(bytes);
    width = dims.width;
    height = dims.height;
    const verdict = verdictFor(format, cornerClass, opts.expected);
    return { format, width, height, hasAlpha, cornerClass, verdict };
  }
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
