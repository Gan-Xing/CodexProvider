export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeRole(role: unknown): string {
  const normalized = normalizeString(role);
  if (normalized === 'developer') {
    return 'system';
  }
  if (normalized === 'assistant' || normalized === 'system' || normalized === 'tool') {
    return normalized;
  }
  return 'user';
}
