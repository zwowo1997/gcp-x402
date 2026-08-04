const knownServiceUrls = [
  "https://gcp-x402-tokyo-837831206506.asia-northeast1.run.app",
  "https://gcp-x402-837831206506.us-central1.run.app",
];

export function renderSkillForOrigin(markdown: string, origin: string): string {
  const normalizedOrigin = origin.replace(/\/$/, "");
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
