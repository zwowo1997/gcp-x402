/** Cloud Run/Pub/Sub-safe name: lowercase, starts with a letter, and never ends in a hyphen. */
export function tradingResourceName(prefix: string, stackId: string): string {
  const suffix = stackId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24).replace(/-+$/g, "");
  return `${prefix}-${suffix}`.slice(0, 49).replace(/-+$/g, "");
}
