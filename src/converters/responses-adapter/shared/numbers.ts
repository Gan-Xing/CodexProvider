export function normalizeNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizePositiveOrZeroNumber(value: unknown): number | null {
  const number = normalizeNumber(value);
  return number !== null && number >= 0 ? number : null;
}

export function multiplyFinite(left: number | null, right: number | null): number | null {
  if (left === null || right === null) {
    return null;
  }
  const product = left * right;
  return Number.isFinite(product) ? product : null;
}
