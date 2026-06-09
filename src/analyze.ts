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
