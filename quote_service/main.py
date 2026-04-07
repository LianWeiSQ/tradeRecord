from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .errors import AppError
from .schemas import (
    BackupPayload,
    ExcelImportPayload,
    PositionEventUpdateInput,
    PriceSnapshotUpdateInput,
    QuotePositionPayload,
    QuoteRefreshRequest,
    QuoteServiceHealth,
    ReviewUpdateInput,
    StrategyPositionInput,
    PositionEventInput,
    PriceSnapshotInput,
)
from .storage import (
    clear_all_data,
    create_strategy_position,
    delete_position_event,
    delete_price_snapshot,
    export_backup_payload,
    get_trade_bundle,
    init_db,
    list_open_quote_positions,
    now_iso,
    restore_backup_payload,
    save_close_snapshot_with_signature,
    save_import_batch,
    save_price_snapshot,
    update_position_event,
    update_price_snapshot,
    update_position_review,
    add_position_event,
)

try:
    import akshare as ak
except ImportError:  # pragma: no cover - runtime dependency
    ak = None


BASE_DIR = Path(__file__).resolve().parent
STATE_DIR = BASE_DIR / "runtime"
STATE_FILE = STATE_DIR / "quote_state.json"
SOURCE_LABEL = "AkShare"
SNAPSHOT_HOUR = 15
SNAPSHOT_MINUTE = 5
FINANCIAL_PREFIXES = {"IF", "IH", "IC", "IM", "TF", "T", "TS", "TL"}
state_lock = threading.Lock()

app = FastAPI(title="Trade Record Backend", version="3.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def handle_app_error(_: Request, error: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=error.status_code,
        content={"error": {"code": error.code, "message": error.message}},
    )


def load_quote_state() -> dict[str, Any]:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if not STATE_FILE.exists():
        return {
            "cached_quotes": [],
            "last_refresh_at": None,
            "last_close_snapshot_date": None,
        }
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def save_quote_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def normalize_symbol(symbol: str) -> str:
    return symbol.replace(" ", "").upper()


def market_for_symbol(symbol: str) -> str | None:
    normalized = normalize_symbol(symbol)
    prefix = "".join(char for char in normalized if char.isalpha())
    if not prefix:
        return None
    if prefix in FINANCIAL_PREFIXES:
        return "FF"
    if any(char.isdigit() for char in normalized):
        return "CF"
    return None


def normalize_row_keys(row: dict[str, Any]) -> dict[str, Any]:
    return {str(key).strip().lower(): value for key, value in row.items()}


def extract_price(row: dict[str, Any]) -> float | None:
    normalized = normalize_row_keys(row)
    for key in ("current_price", "latest_price", "last_price", "最新价", "current", "price"):
        value = normalized.get(key.lower())
        if value in ("", None):
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return None


def extract_symbol(row: dict[str, Any]) -> str | None:
    normalized = normalize_row_keys(row)
    for key in ("symbol", "合约", "contract", "代码"):
        value = normalized.get(key.lower())
        if value:
            return normalize_symbol(str(value))
    return None


def fetch_market_quotes(symbols: list[str], market: str) -> dict[str, float]:
    if ak is None:
        raise RuntimeError("AkShare 未安装，请先运行 npm run quotes:install")
    if not symbols:
        return {}
    frame = ak.futures_zh_spot(symbol=",".join(symbols), market=market, adjust="0")
    records = frame.to_dict(orient="records")
    prices: dict[str, float] = {}
    for row in records:
        symbol = extract_symbol(row)
        price = extract_price(row)
        if symbol and price is not None:
            prices[symbol] = price
    return prices


def fetch_symbol_prices(symbols: list[str]) -> tuple[dict[str, float], dict[str, str]]:
    grouped: dict[str, list[str]] = {"FF": [], "CF": []}
    errors: dict[str, str] = {}

    for symbol in {normalize_symbol(item) for item in symbols if item}:
        market = market_for_symbol(symbol)
        if market is None:
            errors[symbol] = "暂不支持该合约的自动行情"
            continue
        grouped[market].append(symbol)

    prices: dict[str, float] = {}
    for market, market_symbols in grouped.items():
        if not market_symbols:
            continue
        try:
            prices.update(fetch_market_quotes(market_symbols, market))
        except Exception as error:  # pragma: no cover
            for symbol in market_symbols:
                errors[symbol] = str(error)

    for symbol in symbols:
        normalized = normalize_symbol(symbol)
        if normalized not in prices and normalized not in errors:
            errors[normalized] = "行情源未返回该合约价格"

    return prices, errors


def build_live_quotes(positions: list[QuotePositionPayload]) -> list[dict[str, Any]]:
    requested_symbols: list[str] = []
    for position in positions:
        if position.underlyingSymbol:
            requested_symbols.append(position.underlyingSymbol)
        for leg in position.legs:
            if leg.instrumentType == "future":
                requested_symbols.append(leg.contractCode)

    prices, errors = fetch_symbol_prices(requested_symbols)
    as_of = now_iso()
    quotes: list[dict[str, Any]] = []

    for position in positions:
        underlying_symbol = normalize_symbol(position.underlyingSymbol)
        underlying_price = prices.get(underlying_symbol)
        leg_quotes: list[dict[str, Any]] = []
        auto_count = 0

        for leg in position.legs:
            normalized_code = normalize_symbol(leg.contractCode)
            if leg.instrumentType == "future":
                mark_price = prices.get(normalized_code)
                if mark_price is not None:
                    auto_count += 1
                    leg_quotes.append(
                        {
                            "legId": leg.id,
                            "contractCode": leg.contractCode,
                            "instrumentType": leg.instrumentType,
                            "markPrice": mark_price,
                            "coverage": "auto",
                            "sourceLabel": SOURCE_LABEL,
                        }
                    )
                else:
                    leg_quotes.append(
                        {
                            "legId": leg.id,
                            "contractCode": leg.contractCode,
                            "instrumentType": leg.instrumentType,
                            "coverage": "missing",
                            "sourceLabel": SOURCE_LABEL,
                            "message": errors.get(normalized_code, "未读取到行情"),
                        }
                    )
            else:
                leg_quotes.append(
                    {
                        "legId": leg.id,
                        "contractCode": leg.contractCode,
                        "instrumentType": leg.instrumentType,
                        "coverage": "manual_required",
                        "sourceLabel": SOURCE_LABEL,
                        "message": "期权需手动估值",
                    }
                )

        if auto_count == 0 and underlying_price is None:
            coverage_status = "none"
        elif all(item["coverage"] == "auto" for item in leg_quotes):
            coverage_status = "full"
        else:
            coverage_status = "partial"

        quotes.append(
            {
                "positionId": position.positionId,
                "asOf": as_of,
                "underlyingPrice": underlying_price,
                "legQuotes": leg_quotes,
                "coverageStatus": coverage_status,
                "sourceLabel": SOURCE_LABEL,
                "message": errors.get(underlying_symbol) if underlying_price is None else None,
            }
        )

    return quotes


def get_default_quote_positions() -> list[QuotePositionPayload]:
    return [QuotePositionPayload.model_validate(item) for item in list_open_quote_positions()]


def refresh_and_cache_quotes(positions: list[QuotePositionPayload]) -> tuple[list[dict[str, Any]], str]:
    quotes = build_live_quotes(positions)
    refreshed_at = now_iso()
    with state_lock:
        state = load_quote_state()
        state["cached_quotes"] = quotes
        state["last_refresh_at"] = refreshed_at
        save_quote_state(state)
    return quotes, refreshed_at


def build_close_snapshots(quotes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    trading_day = datetime.now().date().isoformat()
    created: list[dict[str, Any]] = []

    for quote in quotes:
        leg_marks = [
            {"legId": item["legId"], "markPrice": item["markPrice"]}
            for item in quote["legQuotes"]
            if item.get("markPrice") is not None
        ]
        if not leg_marks and quote.get("underlyingPrice") is None:
            continue

        signature = f"{trading_day}:{quote['positionId']}"
        saved = save_close_snapshot_with_signature(
            PriceSnapshotInput(
                positionId=quote["positionId"],
                snapshotAt=quote["asOf"],
                underlyingPrice=quote.get("underlyingPrice"),
                legMarks=leg_marks,
                note="自动收盘快照（期货与标的自动估值，期权请手动补录）",
            ),
            signature,
        )
        if saved:
            created.append({"signature": signature, "positionId": quote["positionId"]})

    with state_lock:
        state = load_quote_state()
        state["last_close_snapshot_date"] = datetime.now().date().isoformat()
        save_quote_state(state)

    return created


def scheduler_loop() -> None:  # pragma: no cover
    while True:
        try:
            current = datetime.now()
            should_run = current.weekday() < 5 and (current.hour, current.minute) >= (
                SNAPSHOT_HOUR,
                SNAPSHOT_MINUTE,
            )
            if should_run:
                with state_lock:
                    state = load_quote_state()
                    already_done = state.get("last_close_snapshot_date") == current.date().isoformat()
                if not already_done:
                    positions = get_default_quote_positions()
                    if positions:
                        quotes, refreshed_at = refresh_and_cache_quotes(positions)
                        for quote in quotes:
                            quote["asOf"] = refreshed_at
                        build_close_snapshots(quotes)
        except Exception:
            pass

        time.sleep(30)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    thread = threading.Thread(target=scheduler_loop, daemon=True)
    thread.start()


@app.get("/health", response_model=QuoteServiceHealth)
def get_health() -> QuoteServiceHealth:
    status = "ok" if ak is not None else "offline"
    message = None if ak is not None else "AkShare 未安装，自动行情暂不可用"
    with state_lock:
        state = load_quote_state()
    if status == "ok" and not state.get("cached_quotes"):
        status = "degraded"
        message = "后端已启动，等待首次行情刷新"
    return QuoteServiceHealth(
        status=status,
        sourceLabel=SOURCE_LABEL,
        checkedAt=now_iso(),
        message=message,
    )


@app.get("/api/trades/bundle")
def get_bundle() -> dict[str, Any]:
    return get_trade_bundle().model_dump()


@app.post("/api/trades/positions")
def create_position(input_data: StrategyPositionInput) -> dict[str, str]:
    return {"positionId": create_strategy_position(input_data)}


@app.post("/api/trades/events")
def create_event(input_data: PositionEventInput) -> dict[str, bool]:
    add_position_event(input_data)
    return {"ok": True}


@app.put("/api/trades/events/{event_id}")
def update_event(event_id: str, input_data: PositionEventUpdateInput) -> dict[str, bool]:
    update_position_event(event_id, input_data)
    return {"ok": True}


@app.delete("/api/trades/events/{event_id}")
def remove_event(event_id: str) -> dict[str, bool]:
    delete_position_event(event_id)
    return {"ok": True}


@app.post("/api/trades/snapshots")
def create_snapshot(input_data: PriceSnapshotInput) -> dict[str, bool]:
    save_price_snapshot(input_data)
    return {"ok": True}


@app.put("/api/trades/snapshots/{snapshot_id}")
def update_snapshot(snapshot_id: str, input_data: PriceSnapshotUpdateInput) -> dict[str, bool]:
    update_price_snapshot(snapshot_id, input_data)
    return {"ok": True}


@app.delete("/api/trades/snapshots/{snapshot_id}")
def remove_snapshot(snapshot_id: str) -> dict[str, bool]:
    delete_price_snapshot(snapshot_id)
    return {"ok": True}


@app.put("/api/trades/reviews/{position_id}")
def save_review(position_id: str, review: ReviewUpdateInput) -> dict[str, bool]:
    update_position_review(position_id, review)
    return {"ok": True}


@app.post("/api/trades/import")
def import_batch(payload: ExcelImportPayload) -> dict[str, bool]:
    save_import_batch(payload.positions, payload.stats)
    return {"ok": True}


@app.get("/api/trades/backup")
def export_backup() -> dict[str, Any]:
    return export_backup_payload().model_dump()


@app.post("/api/trades/restore")
def restore_backup(payload: BackupPayload) -> dict[str, bool]:
    restore_backup_payload(payload)
    return {"ok": True}


@app.delete("/api/trades/all")
def delete_all_data() -> dict[str, bool]:
    clear_all_data()
    return {"ok": True}


@app.get("/quotes/open-positions")
def get_cached_open_position_quotes() -> dict[str, Any]:
    with state_lock:
        state = load_quote_state()
    return {
        "quotes": state.get("cached_quotes", []),
        "asOf": state.get("last_refresh_at"),
    }


@app.post("/quotes/refresh")
def post_refresh_quotes(payload: QuoteRefreshRequest) -> dict[str, Any]:
    positions = payload.positions or get_default_quote_positions()
    if not positions:
        return {"quotes": [], "asOf": now_iso()}
    try:
        quotes, refreshed_at = refresh_and_cache_quotes(positions)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {"quotes": quotes, "asOf": refreshed_at}


@app.post("/quotes/snapshot/close")
def post_close_snapshot(payload: QuoteRefreshRequest) -> dict[str, Any]:
    positions = payload.positions or get_default_quote_positions()
    if not positions:
        return {"snapshots": []}
    try:
        quotes, refreshed_at = refresh_and_cache_quotes(positions)
        for quote in quotes:
            quote["asOf"] = refreshed_at
        snapshots = build_close_snapshots(quotes)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {"snapshots": snapshots}


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    uvicorn.run("quote_service.main:app", host="127.0.0.1", port=8765, reload=False)
