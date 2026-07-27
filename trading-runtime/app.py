"""Paper-only Hyperliquid trading runtime.

This image deliberately has no exchange-order implementation. It receives real
public market data, persists it, and produces simulated EMA hedge orders only.
"""

import asyncio
import base64
import hashlib
import json
import os
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import websockets
from fastapi import FastAPI, HTTPException, Request
from google.cloud import pubsub_v1, spanner
from hyperliquid.info import Info  # Official SDK is deliberately present for the future execution adapter.

ROLE = os.environ.get("ROLE", "")
PAPER_ONLY = os.environ.get("PAPER_ONLY") == "true"
PROJECT_ID = os.environ["GCP_PROJECT_ID"]
TOPIC = os.environ["PUBSUB_TOPIC"]
SPANNER_INSTANCE = os.environ["SPANNER_INSTANCE"]
SPANNER_DATABASE = os.environ["SPANNER_DATABASE"]
TENANT_ID = os.environ["TENANT_ID"]
WS_URL = os.environ.get("HYPERLIQUID_WS_URL", "wss://api.hyperliquid.xyz/ws")
MARKET_PUBLISH_INTERVAL_SECONDS = float(os.environ.get("MARKET_PUBLISH_INTERVAL_SECONDS", "5"))
FAST_EMA = int(os.environ.get("FAST_EMA", "9"))
SLOW_EMA = int(os.environ.get("SLOW_EMA", "21"))
EVALUATION_INTERVAL_SECONDS = int(os.environ.get("EVALUATION_INTERVAL_SECONDS", "60"))
MAX_ORDER_NOTIONAL_USD = float(os.environ.get("MAX_ORDER_NOTIONAL_USD", "1000"))
MAX_POSITION_NOTIONAL_USD = float(os.environ.get("MAX_POSITION_NOTIONAL_USD", "2000"))
MAX_DAILY_LOSS_USD = float(os.environ.get("MAX_DAILY_LOSS_USD", "500"))
VIRTUAL_BALANCE_USD = float(os.environ.get("VIRTUAL_BALANCE_USD", "10000"))
SLIPPAGE_BPS = float(os.environ.get("SLIPPAGE_BPS", "5"))

if not PAPER_ONLY:
    raise RuntimeError("This runtime is paper-only; real execution is intentionally disabled.")

publisher = pubsub_v1.PublisherClient()
spanner_client = spanner.Client(project=PROJECT_ID)
database = spanner_client.instance(SPANNER_INSTANCE).database(SPANNER_DATABASE)
prices: deque[float] = deque(maxlen=64)
state = {"last_signal": "flat", "position_notional": 0.0, "equity": VIRTUAL_BALANCE_USD, "daily_pnl": 0.0, "last_price": None, "halted": False}
last_evaluation = 0.0
last_published = {"mid": 0.0, "trade": 0.0}


def now() -> datetime:
    return datetime.now(timezone.utc)


def event_id(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def ema(values: list[float], period: int) -> float:
    """Calculate a conventional EMA, seeded with the first period's SMA."""
    window = values[-max(period * 3, period):]
    result = sum(window[:period]) / period
    alpha = 2 / (period + 1)
    for value in window[period:]:
        result = (value * alpha) + (result * (1 - alpha))
    return result


def publish(payload: dict) -> None:
    payload["event_id"] = payload.get("event_id") or event_id(payload)
    payload["observed_at"] = payload.get("observed_at") or now().isoformat()
    publisher.publish(publisher.topic_path(PROJECT_ID, TOPIC), json.dumps(payload).encode(), event_id=payload["event_id"], event_type=payload.get("type", "market")).result(timeout=10)


def publish_sampled(payload: dict) -> None:
    event_type = payload["type"]
    current = time.monotonic()
    if current - last_published[event_type] < MARKET_PUBLISH_INTERVAL_SECONDS:
        return
    last_published[event_type] = current
    publish(payload)


async def collect() -> None:
    while True:
        try:
            async with websockets.connect(WS_URL, ping_interval=20, ping_timeout=20) as ws:
                await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "allMids"}}))
                await ws.send(json.dumps({"method": "subscribe", "subscription": {"type": "trades", "coin": "BTC"}}))
                while True:
                    message = json.loads(await ws.recv())
                    channel = message.get("channel")
                    data = message.get("data", {})
                    if channel == "allMids" and "BTC" in data.get("mids", {}):
                        publish_sampled({"type": "mid", "symbol": "BTC", "mid": float(data["mids"]["BTC"]), "source": "hyperliquid"})
                    elif channel == "trades":
                        for trade in data:
                            if trade.get("coin") == "BTC":
                                publish_sampled({"type": "trade", "symbol": "BTC", "price": float(trade["px"]), "size": float(trade["sz"]), "side": trade.get("side"), "source": "hyperliquid"})
        except Exception as error:
            print(f"collector reconnecting after error: {error}", flush=True)
            await asyncio.sleep(2)


def decode_push(request_json: dict) -> dict:
    message = request_json.get("message", {})
    encoded = message.get("data")
    if not encoded:
        raise ValueError("Missing Pub/Sub message data")
    return json.loads(base64.b64decode(encoded).decode())


def persist_market_event(event: dict) -> None:
    if event.get("type") not in {"mid", "trade"}:
        return
    observed = datetime.fromisoformat(event["observed_at"].replace("Z", "+00:00"))
    price = float(event.get("mid", event.get("price", 0)))
    with database.batch() as batch:
        batch.insert_or_update(
            table="MarketSnapshots",
            columns=("TenantId", "event_id", "observed_at", "symbol", "mid", "raw_json", "commit_ts"),
            values=[(TENANT_ID, event["event_id"], observed, event["symbol"], price, json.dumps(event), spanner.COMMIT_TIMESTAMP)],
        )


def simulate_strategy(event: dict) -> None:
    global last_evaluation
    if event.get("type") != "mid" or event.get("symbol") != "BTC":
        return
    price = float(event["mid"])
    prices.append(price)
    if time.monotonic() - last_evaluation < EVALUATION_INTERVAL_SECONDS:
        return
    last_evaluation = time.monotonic()
    previous_price = state["last_price"]
    if previous_price and state["position_notional"]:
        quantity_held = abs(state["position_notional"]) / previous_price
        pnl = (price - previous_price) * quantity_held * (1 if state["position_notional"] > 0 else -1)
        state["daily_pnl"] += pnl
        state["equity"] += pnl
    state["last_price"] = price
    if state["daily_pnl"] <= -MAX_DAILY_LOSS_USD:
        state["halted"] = True
        with database.batch() as batch:
            batch.insert_or_update(
                table="StrategyState",
                columns=("TenantId", "state_key", "updated_at", "payload"),
                values=[(TENANT_ID, "current", now(), json.dumps(state | {"halt_reason": "max_daily_loss"}))],
            )
        return
    if state["halted"]:
        return
    if len(prices) < SLOW_EMA:
        return
    history = list(prices)
    fast = ema(history, FAST_EMA)
    slow = ema(history, SLOW_EMA)
    signal = "long_hedge" if fast > slow else "short_hedge"
    if signal == state["last_signal"]:
        return
    state["last_signal"] = signal
    order_id = f"paper-{uuid.uuid4()}"
    target_notional = min(MAX_ORDER_NOTIONAL_USD, MAX_POSITION_NOTIONAL_USD)
    quantity = round(target_notional / price, 6)
    side = "buy" if signal == "long_hedge" else "sell"
    state["position_notional"] = target_notional if side == "buy" else -target_notional
    with database.batch() as batch:
        batch.insert_or_update(
            table="SimulatedOrders",
            columns=("TenantId", "order_id", "created_at", "side", "quantity", "price", "status", "payload"),
            values=[(TENANT_ID, order_id, now(), side, quantity, price, "filled", json.dumps({"paper": True, "fast_ema": fast, "slow_ema": slow, "slippage_bps": SLIPPAGE_BPS, "event_id": event["event_id"]}))],
        )
        batch.insert_or_update(
            table="StrategyState",
            columns=("TenantId", "state_key", "updated_at", "payload"),
            values=[(TENANT_ID, "current", now(), json.dumps(state | {"fast_ema": fast, "slow_ema": slow, "last_price": price}))],
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(collect()) if ROLE == "collector" else None
    yield
    if task:
        task.cancel()


app = FastAPI(title="gcp-x402 paper trading runtime", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    return {"ok": True, "role": ROLE, "paperOnly": PAPER_ONLY, "timestamp": now().isoformat()}


@app.post("/events")
async def events(request: Request):
    if ROLE not in {"writer", "strategy"}:
        raise HTTPException(status_code=404, detail="This runtime role does not consume Pub/Sub events.")
    try:
        event = decode_push(await request.json())
        if ROLE == "writer":
            persist_market_event(event)
        else:
            simulate_strategy(event)
        return {"ok": True}
    except Exception as error:
        print(f"event processing failed: {error}", flush=True)
        raise HTTPException(status_code=500, detail="Paper event processing failed") from error
