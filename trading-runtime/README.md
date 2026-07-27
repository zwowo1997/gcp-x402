# Paper trading runtime

This is the allowlisted container image deployed for `trading.paper.ema` stacks.
It consumes real public Hyperliquid market data but contains no exchange-order path,
wallet key, API-wallet support, or testnet/mainnet execution mode.

Each deployed stack creates three private Cloud Run services in `asia-northeast1`:

- `collector`: subscribes only to public BTC market data and publishes it to Pub/Sub.
- `writer`: writes received market events into that renter's `TenantId` namespace in the shared Spanner database.
- `strategy`: calculates configured EMAs and records simulated orders; it cannot sign or submit an exchange order.

`PAPER_ONLY=true` is mandatory at process start. Removing it makes the image fail rather
than enabling an execution mode. The installed official Hyperliquid SDK is reserved for
a future, separately reviewed adapter; this image has no wallet credentials or trading API calls.
