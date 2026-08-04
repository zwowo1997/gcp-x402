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
 * MoonPay hosts its own test checkout. It is deliberately separate from Base
 * Sepolia x402: MoonPay's published test assets are on Ethereum Sepolia.
 */
export function paymentProviderInfo(value: string): PaymentProviderInfo {
  if (value === "moonpay-test") return {
    id: "moonpay-test", mode: "external-test", label: "MoonPay test mode",
    checkout: "moonpay-hosted", supportsBaseSepolia: false,
    note: "MoonPay test checkout uses simulated payment and Ethereum Sepolia test assets, not Base Sepolia. It cannot fund x402 settlement.",
  };
  return {
    id: "simulator", mode: "local-sandbox", label: "gcp-x402 sandbox",
    checkout: "in-app-simulation", supportsBaseSepolia: false,
    note: "No funds move. A local test wallet and a provider-style payment trace are used for the full safe rehearsal.",
  };
}
