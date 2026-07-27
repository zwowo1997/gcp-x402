export type SpannerValue = string | number | boolean | null | { stringValue?: string; numberValue?: number; timestampValue?: string; boolValue?: boolean; nullValue?: null };

export function spannerValueOf(value: SpannerValue | undefined): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") return value;
  if ("nullValue" in value) return null;
  return value.stringValue ?? value.timestampValue ?? value.numberValue ?? value.boolValue ?? null;
}
