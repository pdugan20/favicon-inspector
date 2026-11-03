import { deflateSync } from 'node:zlib';
import { encode as encodePng } from 'fast-png';
import * as jpeg from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { analyzeImage, boundedImageInput, decodeToRgba } from '../analyze.js';
import { perceptualHash } from '../perceptualHash.js';

function pixel() {
  return Buffer.from(
    encodePng({
      width: 1,
      height: 1,
      channels: 4,
      data: new Uint8Array([1, 2, 3, 255]),
    })
  );
}
function chunk(type: string, data: Buffer) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(type, 4);
  data.copy(out, 8);
  return out;
}

describe('bounded untrusted image decoding', () => {
  it('rejects oversized declared PNG geometry before allocating pixels', () => {
    const bytes = pixel();
    bytes.writeUInt32BE(100_000, 16);
    bytes.writeUInt32BE(100_000, 20);
    expect(() => boundedImageInput(bytes)).toThrow(/pixel limit/);
    expect(analyzeImage(bytes).cornerClass).toBe('UNDECODED');
  });
  it('rejects a compressed IDAT bomb with a tiny declared frame', () => {
    const bytes = Buffer.concat([
      pixel().subarray(0, 33),
      chunk('IDAT', deflateSync(Buffer.alloc(2 * 1024 * 1024))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(() => boundedImageInput(bytes)).toThrow();
    expect(analyzeImage(bytes).cornerClass).toBe('UNDECODED');
  });
  it('strips compressed ancillary profiles before either decoder consumes them', async () => {
    const original = pixel();
    const bytes = Buffer.concat([
      original.subarray(0, 33),
      chunk(
        'iCCP',
        Buffer.concat([
          Buffer.from('profile\0\0'),
          deflateSync(Buffer.alloc(2 * 1024 * 1024)),
        ])
      ),
      original.subarray(33),
    ]);
    expect(boundedImageInput(bytes)).toEqual(original);
    expect(analyzeImage(bytes).cornerClass).toBe(
      analyzeImage(original).cornerClass
    );
    expect(await perceptualHash(bytes)).toBe(await perceptualHash(original));
  });
  it('uses the JPEG decoder resolution bound before its frame allocation', () => {
    const bytes = Buffer.from(
      jpeg.encode({ width: 8, height: 8, data: Buffer.alloc(8 * 8 * 4) }, 80)
        .data
    );
    const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]));
    expect(sof).toBeGreaterThan(0);
    bytes.writeUInt16BE(50_000, sof + 5);
    bytes.writeUInt16BE(50_000, sof + 7);
    expect(() => decodeToRgba(bytes, 'jpeg')).toThrow(/maxResolution/);
  });
  it('bounds SVG rasterization instead of allocating its declared canvas', async () => {
    expect(
      await perceptualHash(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"><rect width="100000" height="100000"/></svg>'
        )
      )
    ).toBeNull();
  });
  it('rejects non-ASCII chunk names that could disagree between decoders', () => {
    const fake = chunk('IDAT', deflateSync(Buffer.alloc(5)));
    Buffer.from([0xc9, 0xc4, 0xc1, 0xd4]).copy(fake, 4);
    const bytes = Buffer.concat([
      pixel().subarray(0, 33),
      fake,
      chunk('IDAT', deflateSync(Buffer.alloc(2 * 1024 * 1024))),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(() => boundedImageInput(bytes)).toThrow(/chunk type/);
  });
  it('rejects raster images embedded inside a tiny SVG canvas', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="data:image/png;base64,' +
        pixel().toString('base64') +
        '"/></svg>'
    );
    expect(() => boundedImageInput(svg)).toThrow(/embedded/);
    expect(await perceptualHash(svg)).toBeNull();
  });
  it.each([
    '<use href="https://example.com/x.svg#image"/>',
    '<use href="&#x23;symbol"/>',
    '<style>@import "https://example.com/x.css";</style>',
    '<path fill="url(data:image/svg+xml,evil)"/>',
    '<path fill="u\\72l(data:evil)"/>',
  ])('rejects indirect SVG resource references: %s', (part) => {
    expect(() =>
      boundedImageInput(Buffer.from('<svg>' + part + '</svg>'))
    ).toThrow();
  });
  it('retains ordinary vectors and local symbol/gradient references', () => {
    const bytes = Buffer.from(
      '<svg><defs><path id="a" d="M0 0h10v10Z"/></defs><use href="#a" fill="url(#gradient)"/></svg>'
    );
    expect(boundedImageInput(bytes)).toEqual(bytes);
  });
  it('does not let native auto-detection bypass SVG guards through unknown encodings', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><image href="data:image/png;base64,' +
      pixel().toString('base64') +
      '"/></svg>';
    expect(
      await perceptualHash(
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(svg, 'utf16le')])
      )
    ).toBeNull();
  });
});
