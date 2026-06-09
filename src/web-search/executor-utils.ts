export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeFiniteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}
