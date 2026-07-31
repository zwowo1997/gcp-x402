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
