const knownServiceUrls = [
  "https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app",
  "https://gcp-x402-837831206506.us-central1.run.app",
];
const previewPlaceholder = "https://gcp-x402-v3-preview.example.invalid";

/** Both the simulation-only preview and the gated V3 testnet service publish
 * the native V3 skill. The legacy skill is reserved for the V2 service. */
export function shouldServeV3Skill(flags: { v3PreviewOnly: boolean; v3TestnetDeploymentEnabled: boolean }): boolean {
  return flags.v3PreviewOnly || flags.v3TestnetDeploymentEnabled;
}

export function renderSkillForOrigin(markdown: string, origin: string): string {
  const normalizedOrigin = origin.replace(/\/$/, "");
  if (/^name:\s*gcp-x402-v3-preview\s*$/m.test(markdown)) {
    return markdown.replaceAll(previewPlaceholder, normalizedOrigin);
  }
  return knownServiceUrls.reduce(
    (rendered, serviceUrl) => rendered.replaceAll(serviceUrl, normalizedOrigin),
    markdown,
  );
}

export function publicSkillOrigin(requestUrl: string, configuredOrigin?: string): string {
  const url = new URL(configuredOrigin ?? requestUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Skill origin must use HTTP or HTTPS.");
  return url.origin;
}
