/**
 * Pure zoom-to-point math, extracted for testability.
 *
 * Given a current transform (scale, tx, ty) and a focal point (px, py) in
 * viewport-local coordinates, returns the new transform after applying
 * `factor` so the point under the cursor stays fixed in the viewport.
 */
export function zoomToPoint(
  scale: number,
  tx: number,
  ty: number,
  factor: number,
  px: number,
  py: number,
  min: number,
  max: number,
): { scale: number; tx: number; ty: number } {
  const newScale = Math.min(max, Math.max(min, scale * factor));
  const ratio = newScale / scale;
  return {
    scale: newScale,
    tx: px - (px - tx) * ratio,
    ty: py - (py - ty) * ratio,
  };
}
