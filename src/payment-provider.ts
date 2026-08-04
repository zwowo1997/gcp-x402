export type PaymentProviderId = "simulator" | "moonpay-test";

export interface PaymentProviderInfo {
  id: PaymentProviderId;
  mode: "local-sandbox" | "external-test";
  label: string;
  checkout: "in-app-simulation" | "moonpay-hosted";
  supportsBaseSepolia: false;
  note: string;
}

/**
 * A deliberately narrow adapter contract. MoonPay credentials and webhooks are
 * not implemented until a partner test account is available; callers can still
 * surface the exact integration boundary without pretending a test transfer is
 * available on Base Sepolia.
 */
export function paymentProviderInfo(value: string): PaymentProviderInfo {
  if (value === "moonpay-test") return {
    id: "moonpay-test", mode: "external-test", label: "MoonPay test mode",
    checkout: "moonpay-hosted", supportsBaseSepolia: false,
    note: "MoonPay test mode is pending partner credentials and supports Ethereum Sepolia test assets, not Base Sepolia settlement.",
  };
  return {
    id: "simulator", mode: "local-sandbox", label: "gcp-x402 sandbox",
    checkout: "in-app-simulation", supportsBaseSepolia: false,
    note: "No funds move. A local test wallet and a provider-style payment trace are used for the full safe rehearsal.",
  };
}
