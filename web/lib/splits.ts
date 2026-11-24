// Face-value splits and consolidations come in a few standard ratios.
const SPLIT_FACTORS = [1.5, 2, 2.5, 3, 4, 5, 8, 10, 20, 25, 50, 100];

/** Turn an observed close/previous-close `ratio` into the likely split factor. Snaps to a standard ratio when within 12%. */
export function suggestFactor(ratio: number): number {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return 1;
  const raw = 1 / ratio;
  const up = raw >= 1;
  const mag = up ? raw : ratio; // >= 1 either way
  const best = SPLIT_FACTORS.reduce((b, c) => (Math.abs(Math.log(c / mag)) < Math.abs(Math.log(b / mag)) ? c : b));
  const snapped = Math.abs(Math.log(best / mag)) < 0.12 ? best : mag;
  const out = up ? snapped : 1 / snapped;
  return Number(out.toFixed(4));
}
