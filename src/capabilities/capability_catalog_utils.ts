export function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizePositiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizePositiveOrZeroNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeNullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];
}

export function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export function buildNormalizedModelCatalogMetadata(entry: Record<string, any> | null | undefined): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') {
    return {};
  }
  const contextWindow = normalizePositiveNumber(entry.contextWindow)
    ?? normalizePositiveNumber(entry.context_window)
    ?? normalizePositiveNumber(entry.maxInputTokens)
    ?? normalizePositiveNumber(entry.max_input_tokens);
  const pricing = normalizePricingMetadata(entry);
  return omitUndefined({
    contextWindow: contextWindow ?? undefined,
    pricing: pricing ?? undefined,
  });
}

function normalizePricingMetadata(entry: Record<string, any>): Record<string, unknown> | undefined {
  const source = entry.pricing && typeof entry.pricing === 'object'
    ? entry.pricing as Record<string, any>
    : entry;
  const pricing = omitUndefined({
    inputCostPerToken: normalizePositiveOrZeroNumber(source.inputCostPerToken)
      ?? normalizePositiveOrZeroNumber(source.input_cost_per_token)
      ?? undefined,
    outputCostPerToken: normalizePositiveOrZeroNumber(source.outputCostPerToken)
      ?? normalizePositiveOrZeroNumber(source.output_cost_per_token)
      ?? undefined,
    inputCostPerAudioToken: normalizePositiveOrZeroNumber(source.inputCostPerAudioToken)
      ?? normalizePositiveOrZeroNumber(source.input_cost_per_audio_token)
      ?? undefined,
    outputCostPerReasoningToken: normalizePositiveOrZeroNumber(source.outputCostPerReasoningToken)
      ?? normalizePositiveOrZeroNumber(source.output_cost_per_reasoning_token)
      ?? undefined,
    inputCostPerImage: normalizePositiveOrZeroNumber(source.inputCostPerImage)
      ?? normalizePositiveOrZeroNumber(source.input_cost_per_image)
      ?? undefined,
    outputCostPerImage: normalizePositiveOrZeroNumber(source.outputCostPerImage)
      ?? normalizePositiveOrZeroNumber(source.output_cost_per_image)
      ?? undefined,
    inputCostPerPixel: normalizePositiveOrZeroNumber(source.inputCostPerPixel)
      ?? normalizePositiveOrZeroNumber(source.input_cost_per_pixel)
      ?? undefined,
    outputCostPerPixel: normalizePositiveOrZeroNumber(source.outputCostPerPixel)
      ?? normalizePositiveOrZeroNumber(source.output_cost_per_pixel)
      ?? undefined,
    searchContextCostPerQuery: normalizePricingObject(source.searchContextCostPerQuery)
      ?? normalizePricingObject(source.search_context_cost_per_query)
      ?? undefined,
  });
  return Object.keys(pricing).length > 0 ? pricing : undefined;
}

function normalizePricingObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const normalized = omitUndefined(Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      normalizePositiveOrZeroNumber(entry) ?? undefined,
    ]),
  ));
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
