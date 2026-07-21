import type { OriginAsset } from './origin.js';

/**
 * Origin-side configuration problems that make Google serve a wrong icon,
 * derived from the probed assets (see docs/favicon-findings.md). These catch
 * the failure modes before Google does: a *served* transparent apple-touch
 * (which Google flattens onto black), a non-square master that gets stretched,
 * and a too-small raster master that gets upscaled.
 *
 * Note: a *missing* apple-touch is NOT a problem — it's the recommended state.
 * A transparent favicon with no apple-touch does not flatten to black
 * (verified in production on getbiblio.app); only a served transparent
 * apple-touch does.
 */
export type OriginFindingCode =
  'APPLE_TOUCH_TRANSPARENT' | 'NON_SQUARE_MASTER' | 'SMALL_MASTER';

export interface OriginFinding {
  domain: string;
  code: OriginFindingCode;
  severity: 'WARN' | 'ALERT';
  message: string;
}

/** Below this, Google upscales the source for larger requested sizes. */
const MIN_MASTER_PX = 180;

/** Matches apple-touch-icon, -precomposed, and the Next.js apple-icon name. */
function isAppleTouch(path: string): boolean {
  return /apple-(touch-)?icon/i.test(path);
}

export function deriveOriginFindings(
  domain: string,
  assets: OriginAsset[]
): OriginFinding[] {
  const findings: OriginFinding[] = [];
  const reachable = assets.filter((a) => a.status === 200);
  if (reachable.length === 0) return findings; // can't assess; origin down

  // A *served* transparent apple-touch is the black-square trigger. A missing
  // apple-touch is fine (the recommended state), so it is not flagged.
  const transparent = reachable.find(
    (a) => isAppleTouch(a.path) && a.analysis.cornerClass === 'TRANSPARENT'
  );
  if (transparent) {
    findings.push({
      domain,
      code: 'APPLE_TOUCH_TRANSPARENT',
      severity: 'WARN',
      message: `Transparent apple-touch-icon (${transparent.path}); 404 it or flatten it onto an opaque background so Google does not render it as a black square.`,
    });
  }

  // Largest master that reports intrinsic dimensions (raster or SVG).
  let largest: OriginAsset | null = null;
  let largestDim = 0;
  for (const a of reachable) {
    const { width, height } = a.analysis;
    if (width && height) {
      const dim = Math.max(width, height);
      if (dim > largestDim) {
        largestDim = dim;
        largest = a;
      }
    }
  }
  if (largest && largest.analysis.width !== largest.analysis.height) {
    findings.push({
      domain,
      code: 'NON_SQUARE_MASTER',
      severity: 'WARN',
      message: `Largest master ${largest.path} is ${largest.analysis.width}x${largest.analysis.height} (not square); Google requires 1:1 and will stretch it. Provide a square master.`,
    });
  }

  // A vector source scales cleanly, so only flag small raster-only origins.
  const hasSvg = reachable.some((a) => a.analysis.format === 'svg');
  if (!hasSvg) {
    let rasterMax = 0;
    for (const a of reachable) {
      if (a.analysis.format === 'png' || a.analysis.format === 'jpeg') {
        rasterMax = Math.max(
          rasterMax,
          a.analysis.width ?? 0,
          a.analysis.height ?? 0
        );
      }
    }
    if (rasterMax > 0 && rasterMax < MIN_MASTER_PX) {
      findings.push({
        domain,
        code: 'SMALL_MASTER',
        severity: 'WARN',
        message: `Largest raster master is ${rasterMax}px; Google upscales above this. Add a square master >=512px (or an SVG).`,
      });
    }
  }

  return findings;
}

export function deriveAllOriginFindings(
  origins: Record<string, OriginAsset[]>
): Record<string, OriginFinding[]> {
  const out: Record<string, OriginFinding[]> = {};
  for (const [domain, assets] of Object.entries(origins)) {
    const findings = deriveOriginFindings(domain, assets);
    if (findings.length > 0) out[domain] = findings;
  }
  return out;
}
