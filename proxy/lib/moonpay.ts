import { config } from "./config";
import { signMoonPayWidgetUrl } from "./moonpay-signature";

export interface MoonPayAvailability {
  enabled: boolean;
  mode: "test";
  network: "ethereum-sepolia";
  asset: "USDC";
  fiatAmountUsd: number;
  note: string;
}

export function moonPayAvailability(): MoonPayAvailability {
  const test = config.moonPayPublicKey?.startsWith("pk_test_") ?? false;
  const live = config.moonPayPublicKey?.startsWith("pk_live_") ?? false;
  const testSecret = config.moonPaySecretKey?.startsWith("sk_test_") ?? false;
  const liveSecret = config.moonPaySecretKey?.startsWith("sk_live_") ?? false;
  const amountValid = config.moonPayFiatAmountUsd >= 20 && config.moonPayFiatAmountUsd <= 100;
  if (!test || !testSecret || !amountValid) return { enabled: false, mode: "test", network: "ethereum-sepolia", asset: "USDC", fiatAmountUsd: config.moonPayFiatAmountUsd, note: live || liveSecret ? "Live MoonPay keys are rejected by the V3 beta. Configure matching pk_test_ and sk_test_ keys for the no-money rehearsal." : !amountValid ? "MoonPay is disabled because MOONPAY_FIAT_AMOUNT_USD must be between 20 and 100." : test && !testSecret ? "MoonPay URL signing is not configured. Add the matching sk_test_ key through MOONPAY_SECRET_KEY in Secret Manager." : "MoonPay is not configured. The sandbox simulator remains available without card data or a real payment." };
  return {
    enabled: true,
    mode: "test",
    network: "ethereum-sepolia",
    asset: "USDC",
    fiatAmountUsd: config.moonPayFiatAmountUsd,
    note: "MoonPay test mode uses simulated payment and Ethereum Sepolia test assets. It does not fund Base Sepolia x402 settlement.",
  };
}

export function moonPayCheckoutUrl(input: { stackId: string; walletAddress: string; requestOrigin: string }): string {
  const availability = moonPayAvailability();
  if (!availability.enabled || !config.moonPayPublicKey || !config.moonPaySecretKey) throw new Error("MoonPay checkout is not configured. Set matching MOONPAY_PUBLIC_KEY and MOONPAY_SECRET_KEY test credentials.");
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.walletAddress)) throw new Error("MoonPay checkout requires a valid EVM destination address.");
  const configuredOrigin = config.publicBaseUrl ?? input.requestOrigin;
  if (process.env.NODE_ENV === "production" && !config.publicBaseUrl) throw new Error("PUBLIC_BASE_URL is required for a production MoonPay checkout return URL.");
  const returnOrigin = new URL(configuredOrigin);
  if (process.env.NODE_ENV === "production" && returnOrigin.protocol !== "https:") throw new Error("PUBLIC_BASE_URL must use HTTPS for a production MoonPay checkout.");
  const url = new URL("https://buy-sandbox.moonpay.com/");
  url.search = new URLSearchParams({
    apiKey: config.moonPayPublicKey,
    currencyCode: "usdc",
    baseCurrencyCode: "usd",
    baseCurrencyAmount: String(config.moonPayFiatAmountUsd),
    walletAddress: input.walletAddress,
    externalTransactionId: `gcp-x402-${input.stackId}`,
    redirectURL: `${returnOrigin.origin}/v3-demo/moonpay-return?stack=${encodeURIComponent(input.stackId)}`,
  }).toString();
  // MoonPay requires signature to be URL-encoded and appended after every signed parameter.
  return signMoonPayWidgetUrl(url, config.moonPaySecretKey);
}
