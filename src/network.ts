export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEPLOYMENT_TIMEOUT_MS = 180_000;

function requestHostname(input: Parameters<typeof fetch>[0]): string {
  try {
    if (input instanceof Request) return new URL(input.url).hostname;
    return new URL(String(input)).hostname;
  } catch {
    return "remote service";
  }
}

/** Fail visibly when an agent runner has no outbound DNS/network permission. */
export async function boundedFetch(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1] = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Network request to ${requestHostname(input)} failed: ${detail}. ` +
      "If this is a sandboxed coding agent, enable outbound network access and rerun the same idempotent command.",
      { cause: error },
    );
  }
}
