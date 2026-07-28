import { type PaperStrategyConfig } from "./types";

export const PAPER_TRADING_PROFILE = {
  id: "trading.paper.ema" as const,
  description: "Dedicated Tokyo paper-trading stack using real BTC perpetual market data and simulated EMA hedge execution. No Hyperliquid account or trading key is used.",
  region: "asia-northeast1" as const,
  durationHours: 1,
  maxGcpCostUsd: 5,
  priceCeilingUsd: 5,
  mode: "paper" as const,
};

export function defaultPaperConfig(input: Partial<PaperStrategyConfig>): PaperStrategyConfig {
  const config: PaperStrategyConfig = {
    symbol: "BTC",
    fastEma: input.fastEma ?? 9,
    slowEma: input.slowEma ?? 21,
    evaluationIntervalSeconds: 60,
    virtualBalanceUsd: input.virtualBalanceUsd ?? 10_000,
    maxOrderNotionalUsd: input.maxOrderNotionalUsd ?? 1_000,
    maxPositionNotionalUsd: input.maxPositionNotionalUsd ?? 2_000,
    maxDailyLossUsd: input.maxDailyLossUsd ?? 500,
    slippageBps: input.slippageBps ?? 5,
  };
  if (!Number.isInteger(config.fastEma) || !Number.isInteger(config.slowEma) || config.fastEma < 2 || config.slowEma <= config.fastEma || config.slowEma > 64) {
    throw new Error("EMA windows must be integers, slowEma must be greater than fastEma, and slowEma cannot exceed 64.");
  }
  for (const [name, value] of Object.entries({ virtualBalanceUsd: config.virtualBalanceUsd, maxOrderNotionalUsd: config.maxOrderNotionalUsd, maxPositionNotionalUsd: config.maxPositionNotionalUsd, maxDailyLossUsd: config.maxDailyLossUsd })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  }
  if (config.maxOrderNotionalUsd > config.maxPositionNotionalUsd) throw new Error("maxOrderNotionalUsd cannot exceed maxPositionNotionalUsd.");
  if (!Number.isFinite(config.slippageBps) || config.slippageBps < 0 || config.slippageBps > 100) throw new Error("slippageBps must be between 0 and 100.");
  return config;
}
