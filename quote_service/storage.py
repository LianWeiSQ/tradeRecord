from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

from .schemas import (
    BackupPayload,
    DailyStat,
    LegChange,
    PositionEvent,
    PositionEventInput,
    PriceMark,
    PriceSnapshot,
    PriceSnapshotInput,
    ReviewUpdateInput,
    StrategyLeg,
    StrategyLegInput,
    StrategyPosition,
    StrategyPositionInput,
    TradeDataBundle,
)


BASE_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = BASE_DIR / "runtime"
DB_FILE = RUNTIME_DIR / "trade_record.db"

storage_lock = threading.Lock()


def now_iso() -> str:
    from datetime import datetime

    return datetime.now().isoformat(timespec="seconds")


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    return json.loads(value)


def _connect() -> sqlite3.Connection:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            cursor.executescript(
                """
                CREATE TABLE IF NOT EXISTS positions (
                    id TEXT PRIMARY KEY,
                    accountType TEXT NOT NULL,
                    product TEXT NOT NULL,
                    underlyingSymbol TEXT NOT NULL,
                    strategyName TEXT NOT NULL,
                    openedAt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    thesis TEXT NOT NULL,
                    plan TEXT NOT NULL,
                    expectedScenario TEXT NOT NULL,
                    reviewResult TEXT NOT NULL,
                    reviewConclusion TEXT NOT NULL,
                    tags TEXT NOT NULL,
                    remarks TEXT NOT NULL,
                    importNotes TEXT NOT NULL,
                    createdAt TEXT NOT NULL,
                    updatedAt TEXT NOT NULL,
                    latestSnapshotAt TEXT
                );

                CREATE TABLE IF NOT EXISTS legs (
                    id TEXT PRIMARY KEY,
                    positionId TEXT NOT NULL,
                    instrumentType TEXT NOT NULL,
                    side TEXT NOT NULL,
                    contractCode TEXT NOT NULL,
                    optionType TEXT,
                    strikePrice REAL,
                    expiryDate TEXT,
                    qty REAL NOT NULL,
                    entryPrice REAL NOT NULL,
                    multiplier REAL NOT NULL,
                    createdAt TEXT NOT NULL,
                    note TEXT
                );

                CREATE TABLE IF NOT EXISTS events (
                    id TEXT PRIMARY KEY,
                    positionId TEXT NOT NULL,
                    eventType TEXT NOT NULL,
                    occurredAt TEXT NOT NULL,
                    note TEXT NOT NULL,
                    legChanges TEXT NOT NULL,
                    newLegIds TEXT NOT NULL,
                    isInitial INTEGER,
                    createdAt TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS price_snapshots (
                    id TEXT PRIMARY KEY,
                    positionId TEXT NOT NULL,
                    snapshotAt TEXT NOT NULL,
                    underlyingPrice REAL,
                    legMarks TEXT NOT NULL,
                    note TEXT NOT NULL,
                    createdAt TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS stats (
                    id TEXT PRIMARY KEY,
                    date TEXT NOT NULL,
                    sourceLabel TEXT NOT NULL,
                    principal REAL NOT NULL,
                    equity REAL NOT NULL,
                    returnRatio REAL NOT NULL,
                    cashFlow REAL NOT NULL,
                    profit REAL NOT NULL
                );
                """
            )
            connection.commit()
        finally:
            connection.close()


def _position_from_row(row: sqlite3.Row) -> StrategyPosition:
    return StrategyPosition(
        id=row["id"],
        accountType=row["accountType"],
        product=row["product"],
        underlyingSymbol=row["underlyingSymbol"],
        strategyName=row["strategyName"],
        openedAt=row["openedAt"],
        status=row["status"],
        thesis=row["thesis"],
        plan=row["plan"],
        expectedScenario=row["expectedScenario"],
        reviewResult=row["reviewResult"],
        reviewConclusion=row["reviewConclusion"],
        tags=json_loads(row["tags"], []),
        remarks=row["remarks"],
        importNotes=json_loads(row["importNotes"], []),
        createdAt=row["createdAt"],
        updatedAt=row["updatedAt"],
        latestSnapshotAt=row["latestSnapshotAt"],
    )


def _leg_from_row(row: sqlite3.Row) -> StrategyLeg:
    return StrategyLeg(
        id=row["id"],
        positionId=row["positionId"],
        instrumentType=row["instrumentType"],
        side=row["side"],
        contractCode=row["contractCode"],
        optionType=row["optionType"],
        strikePrice=row["strikePrice"],
        expiryDate=row["expiryDate"],
        qty=row["qty"],
        entryPrice=row["entryPrice"],
        multiplier=row["multiplier"],
        createdAt=row["createdAt"],
        note=row["note"],
    )


def _event_from_row(row: sqlite3.Row) -> PositionEvent:
    return PositionEvent(
        id=row["id"],
        positionId=row["positionId"],
        eventType=row["eventType"],
        occurredAt=row["occurredAt"],
        note=row["note"],
        legChanges=[LegChange.model_validate(item) for item in json_loads(row["legChanges"], [])],
        newLegIds=json_loads(row["newLegIds"], []),
        isInitial=bool(row["isInitial"]) if row["isInitial"] is not None else None,
        createdAt=row["createdAt"],
    )


def _snapshot_from_row(row: sqlite3.Row) -> PriceSnapshot:
    return PriceSnapshot(
        id=row["id"],
        positionId=row["positionId"],
        snapshotAt=row["snapshotAt"],
        underlyingPrice=row["underlyingPrice"],
        legMarks=[PriceMark.model_validate(item) for item in json_loads(row["legMarks"], [])],
        note=row["note"],
        createdAt=row["createdAt"],
    )


def _stat_from_row(row: sqlite3.Row) -> DailyStat:
    return DailyStat(
        id=row["id"],
        date=row["date"],
        sourceLabel=row["sourceLabel"],
        principal=row["principal"],
        equity=row["equity"],
        returnRatio=row["returnRatio"],
        cashFlow=row["cashFlow"],
        profit=row["profit"],
    )


def _fetch_all(connection: sqlite3.Connection) -> TradeDataBundle:
    positions = [
        _position_from_row(row)
        for row in connection.execute("SELECT * FROM positions ORDER BY openedAt DESC, createdAt DESC")
    ]
    legs = [_leg_from_row(row) for row in connection.execute("SELECT * FROM legs ORDER BY createdAt DESC")]
    events = [
        _event_from_row(row)
        for row in connection.execute("SELECT * FROM events ORDER BY occurredAt DESC, createdAt DESC")
    ]
    price_snapshots = [
        _snapshot_from_row(row)
        for row in connection.execute(
            "SELECT * FROM price_snapshots ORDER BY snapshotAt DESC, createdAt DESC"
        )
    ]
    stats = [_stat_from_row(row) for row in connection.execute("SELECT * FROM stats ORDER BY date DESC")]
    return TradeDataBundle(
        positions=positions,
        legs=legs,
        events=events,
        priceSnapshots=price_snapshots,
        stats=stats,
    )


def get_trade_bundle() -> TradeDataBundle:
    with storage_lock:
        connection = _connect()
        try:
            return _fetch_all(connection)
        finally:
            connection.close()


def _create_position_record(input_data: StrategyPositionInput) -> StrategyPosition:
    timestamp = now_iso()
    return StrategyPosition(
        id=str(uuid.uuid4()),
        accountType=input_data.accountType,
        product=input_data.product.strip(),
        underlyingSymbol=input_data.underlyingSymbol.strip(),
        strategyName=input_data.strategyName.strip(),
        openedAt=input_data.openedAt,
        status="open",
        thesis=input_data.thesis.strip(),
        plan=input_data.plan.strip(),
        expectedScenario=input_data.expectedScenario.strip(),
        reviewResult=input_data.reviewResult.strip(),
        reviewConclusion=input_data.reviewConclusion.strip(),
        tags=input_data.tags,
        remarks=input_data.remarks.strip(),
        importNotes=input_data.importNotes or [],
        createdAt=timestamp,
        updatedAt=timestamp,
        latestSnapshotAt=None,
    )


def _create_leg_records(position_id: str, opened_at: str, legs: list[StrategyLegInput]) -> list[StrategyLeg]:
    return [
        StrategyLeg(
            id=leg.id or str(uuid.uuid4()),
            positionId=position_id,
            instrumentType=leg.instrumentType,
            side=leg.side,
            contractCode=leg.contractCode.strip(),
            optionType=leg.optionType,
            strikePrice=leg.strikePrice,
            expiryDate=leg.expiryDate,
            qty=leg.qty,
            entryPrice=leg.entryPrice,
            multiplier=leg.multiplier,
            createdAt=leg.createdAt or opened_at,
            note=(leg.note or "").strip() or None,
        )
        for leg in legs
    ]


def _insert_position(cursor: sqlite3.Cursor, position: StrategyPosition) -> None:
    cursor.execute(
        """
        INSERT INTO positions (
            id, accountType, product, underlyingSymbol, strategyName, openedAt, status, thesis,
            plan, expectedScenario, reviewResult, reviewConclusion, tags, remarks, importNotes,
            createdAt, updatedAt, latestSnapshotAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            position.id,
            position.accountType,
            position.product,
            position.underlyingSymbol,
            position.strategyName,
            position.openedAt,
            position.status,
            position.thesis,
            position.plan,
            position.expectedScenario,
            position.reviewResult,
            position.reviewConclusion,
            json_dumps(position.tags),
            position.remarks,
            json_dumps(position.importNotes),
            position.createdAt,
            position.updatedAt,
            position.latestSnapshotAt,
        ),
    )


def _insert_leg(cursor: sqlite3.Cursor, leg: StrategyLeg) -> None:
    cursor.execute(
        """
        INSERT INTO legs (
            id, positionId, instrumentType, side, contractCode, optionType, strikePrice,
            expiryDate, qty, entryPrice, multiplier, createdAt, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            leg.id,
            leg.positionId,
            leg.instrumentType,
            leg.side,
            leg.contractCode,
            leg.optionType,
            leg.strikePrice,
            leg.expiryDate,
            leg.qty,
            leg.entryPrice,
            leg.multiplier,
            leg.createdAt,
            leg.note,
        ),
    )


def _insert_event(cursor: sqlite3.Cursor, event: PositionEvent) -> None:
    cursor.execute(
        """
        INSERT INTO events (
            id, positionId, eventType, occurredAt, note, legChanges, newLegIds, isInitial, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event.id,
            event.positionId,
            event.eventType,
            event.occurredAt,
            event.note,
            json_dumps([item.model_dump() for item in event.legChanges]),
            json_dumps(event.newLegIds),
            1 if event.isInitial else 0 if event.isInitial is not None else None,
            event.createdAt,
        ),
    )


def _insert_snapshot(cursor: sqlite3.Cursor, snapshot: PriceSnapshot) -> None:
    cursor.execute(
        """
        INSERT INTO price_snapshots (
            id, positionId, snapshotAt, underlyingPrice, legMarks, note, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot.id,
            snapshot.positionId,
            snapshot.snapshotAt,
            snapshot.underlyingPrice,
            json_dumps([item.model_dump() for item in snapshot.legMarks]),
            snapshot.note,
            snapshot.createdAt,
        ),
    )


def _insert_stat(cursor: sqlite3.Cursor, stat: DailyStat) -> None:
    cursor.execute(
        """
        INSERT OR REPLACE INTO stats (
            id, date, sourceLabel, principal, equity, returnRatio, cashFlow, profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            stat.id,
            stat.date,
            stat.sourceLabel,
            stat.principal,
            stat.equity,
            stat.returnRatio,
            stat.cashFlow,
            stat.profit,
        ),
    )


def _current_signed_quantity(connection: sqlite3.Connection, leg: StrategyLeg) -> float:
    sign = 1 if leg.side == "long" else -1
    quantity = sign * leg.qty
    rows = connection.execute(
        "SELECT legChanges FROM events WHERE positionId = ? ORDER BY occurredAt ASC, createdAt ASC",
        (leg.positionId,),
    ).fetchall()
    for row in rows:
        changes = json_loads(row["legChanges"], [])
        for change in changes:
            if change["legId"] == leg.id:
                quantity += sign * float(change["quantityChange"])
    return quantity


def _sync_position_status(connection: sqlite3.Connection, position_id: str) -> None:
    legs = [
        _leg_from_row(row)
        for row in connection.execute("SELECT * FROM legs WHERE positionId = ?", (position_id,))
    ]
    total_qty = sum(abs(_current_signed_quantity(connection, leg)) for leg in legs)
    connection.execute(
        "UPDATE positions SET status = ?, updatedAt = ? WHERE id = ?",
        ("open" if total_qty > 0 else "closed", now_iso(), position_id),
    )


def create_strategy_position(input_data: StrategyPositionInput) -> str:
    position = _create_position_record(input_data)
    legs = _create_leg_records(position.id, input_data.openedAt, input_data.legs)
    event = PositionEvent(
        id=str(uuid.uuid4()),
        positionId=position.id,
        eventType="open",
        occurredAt=input_data.openedAt,
        note=input_data.remarks.strip() or "初始开仓",
        legChanges=[
            LegChange(
                legId=leg.id,
                quantityChange=leg.qty,
                price=leg.entryPrice,
                note=leg.note,
            )
            for leg in legs
        ],
        newLegIds=[leg.id for leg in legs],
        isInitial=True,
        createdAt=now_iso(),
    )

    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            _insert_position(cursor, position)
            for leg in legs:
                _insert_leg(cursor, leg)
            _insert_event(cursor, event)
            connection.commit()
        finally:
            connection.close()

    return position.id


def add_position_event(input_data: PositionEventInput) -> None:
    created_legs = _create_leg_records(input_data.positionId, input_data.occurredAt, input_data.newLegs or [])
    event = PositionEvent(
        id=str(uuid.uuid4()),
        positionId=input_data.positionId,
        eventType=input_data.eventType,
        occurredAt=input_data.occurredAt,
        note=input_data.note.strip(),
        legChanges=input_data.legChanges,
        newLegIds=[leg.id for leg in created_legs],
        createdAt=now_iso(),
    )

    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            for leg in created_legs:
                _insert_leg(cursor, leg)
            _insert_event(cursor, event)
            cursor.execute(
                "UPDATE positions SET updatedAt = ? WHERE id = ?",
                (now_iso(), input_data.positionId),
            )
            _sync_position_status(connection, input_data.positionId)
            connection.commit()
        finally:
            connection.close()


def save_price_snapshot(input_data: PriceSnapshotInput) -> None:
    snapshot = PriceSnapshot(
        id=str(uuid.uuid4()),
        positionId=input_data.positionId,
        snapshotAt=input_data.snapshotAt,
        underlyingPrice=input_data.underlyingPrice,
        legMarks=input_data.legMarks,
        note=input_data.note.strip(),
        createdAt=now_iso(),
    )

    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            _insert_snapshot(cursor, snapshot)
            cursor.execute(
                "UPDATE positions SET latestSnapshotAt = ?, updatedAt = ? WHERE id = ?",
                (input_data.snapshotAt, now_iso(), input_data.positionId),
            )
            connection.commit()
        finally:
            connection.close()


def save_close_snapshot_with_signature(input_data: PriceSnapshotInput, signature: str) -> bool:
    note = f"{input_data.note}\n[AUTO_CLOSE:{signature}]"
    with storage_lock:
        connection = _connect()
        try:
            existing = connection.execute(
                "SELECT id FROM price_snapshots WHERE positionId = ? AND note LIKE ? LIMIT 1",
                (input_data.positionId, f"%[AUTO_CLOSE:{signature}]%"),
            ).fetchone()
            if existing:
                return False

            snapshot = PriceSnapshot(
                id=str(uuid.uuid4()),
                positionId=input_data.positionId,
                snapshotAt=input_data.snapshotAt,
                underlyingPrice=input_data.underlyingPrice,
                legMarks=input_data.legMarks,
                note=note,
                createdAt=now_iso(),
            )
            cursor = connection.cursor()
            _insert_snapshot(cursor, snapshot)
            cursor.execute(
                "UPDATE positions SET latestSnapshotAt = ?, updatedAt = ? WHERE id = ?",
                (input_data.snapshotAt, now_iso(), input_data.positionId),
            )
            connection.commit()
            return True
        finally:
            connection.close()


def update_position_review(position_id: str, review: ReviewUpdateInput) -> None:
    with storage_lock:
        connection = _connect()
        try:
            connection.execute(
                """
                UPDATE positions
                SET thesis = ?, plan = ?, expectedScenario = ?, reviewResult = ?,
                    reviewConclusion = ?, remarks = ?, tags = ?, updatedAt = ?
                WHERE id = ?
                """,
                (
                    review.thesis,
                    review.plan,
                    review.expectedScenario,
                    review.reviewResult,
                    review.reviewConclusion,
                    review.remarks,
                    json_dumps(review.tags),
                    now_iso(),
                    position_id,
                ),
            )
            connection.commit()
        finally:
            connection.close()


def save_import_batch(positions: list[StrategyPositionInput], stats: list[DailyStat]) -> None:
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            for input_data in positions:
                position = _create_position_record(input_data)
                legs = _create_leg_records(position.id, input_data.openedAt, input_data.legs)
                event = PositionEvent(
                    id=str(uuid.uuid4()),
                    positionId=position.id,
                    eventType="open",
                    occurredAt=input_data.openedAt,
                    note=input_data.remarks.strip() or "从 Excel 导入",
                    legChanges=[
                        LegChange(
                            legId=leg.id,
                            quantityChange=leg.qty,
                            price=leg.entryPrice,
                            note=leg.note,
                        )
                        for leg in legs
                    ],
                    newLegIds=[leg.id for leg in legs],
                    isInitial=True,
                    createdAt=now_iso(),
                )
                _insert_position(cursor, position)
                for leg in legs:
                    _insert_leg(cursor, leg)
                _insert_event(cursor, event)

            for stat in stats:
                _insert_stat(cursor, stat)

            connection.commit()
        finally:
            connection.close()


def export_backup_payload() -> BackupPayload:
    bundle = get_trade_bundle()
    return BackupPayload(
        version=1,
        exportedAt=now_iso(),
        positions=bundle.positions,
        legs=bundle.legs,
        events=bundle.events,
        priceSnapshots=bundle.priceSnapshots,
        stats=bundle.stats,
    )


def clear_all_data() -> None:
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            cursor.execute("DELETE FROM positions")
            cursor.execute("DELETE FROM legs")
            cursor.execute("DELETE FROM events")
            cursor.execute("DELETE FROM price_snapshots")
            cursor.execute("DELETE FROM stats")
            connection.commit()
        finally:
            connection.close()


def restore_backup_payload(payload: BackupPayload) -> None:
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            cursor.execute("DELETE FROM positions")
            cursor.execute("DELETE FROM legs")
            cursor.execute("DELETE FROM events")
            cursor.execute("DELETE FROM price_snapshots")
            cursor.execute("DELETE FROM stats")

            for position in payload.positions:
                _insert_position(cursor, position)
            for leg in payload.legs:
                _insert_leg(cursor, leg)
            for event in payload.events:
                _insert_event(cursor, event)
            for snapshot in payload.priceSnapshots:
                _insert_snapshot(cursor, snapshot)
            for stat in payload.stats:
                _insert_stat(cursor, stat)

            connection.commit()
        finally:
            connection.close()


def list_open_quote_positions() -> list[dict[str, Any]]:
    bundle = get_trade_bundle()
    legs_by_position: dict[str, list[StrategyLeg]] = {}
    for leg in bundle.legs:
        legs_by_position.setdefault(leg.positionId, []).append(leg)

    return [
        {
            "positionId": position.id,
            "product": position.product,
            "underlyingSymbol": position.underlyingSymbol,
            "legs": [
                {
                    "id": leg.id,
                    "contractCode": leg.contractCode,
                    "instrumentType": leg.instrumentType,
                }
                for leg in legs_by_position.get(position.id, [])
            ],
        }
        for position in bundle.positions
        if position.status == "open"
    ]
