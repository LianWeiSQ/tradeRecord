from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from .domain import calculate_leg_states, days_since, derive_review_status, infer_position_status
from .errors import AppError, ensure
from .schemas import (
    AuditStamp,
    BackupPayload,
    DailyStat,
    LegChange,
    PositionEvent,
    PositionEventInput,
    PositionEventUpdateInput,
    PriceMark,
    PriceSnapshot,
    PriceSnapshotInput,
    PriceSnapshotUpdateInput,
    ReviewUpdateInput,
    StrategyLeg,
    StrategyLegInput,
    StrategyPosition,
    StrategyPositionInput,
    TradeDataBundle,
    WorkflowState,
)

BASE_DIR = Path(__file__).resolve().parent
RUNTIME_DIR = BASE_DIR / "runtime"
BACKUP_DIR = RUNTIME_DIR / "backups"
DB_FILE = RUNTIME_DIR / "trade_record.db"
SCHEMA_VERSION = 2
storage_lock = threading.RLock()


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def json_loads(value: str | None, fallback: Any) -> Any:
    return fallback if not value else json.loads(value)


def _connect() -> sqlite3.Connection:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    return connection


def _table_columns(connection: sqlite3.Connection, table_name: str) -> set[str]:
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {str(row["name"]) for row in rows}


def _ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, column_sql: str) -> None:
    if column_name not in _table_columns(connection, table_name):
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}")


def _create_tables(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS app_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

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
            riskNotes TEXT NOT NULL DEFAULT '',
            exitRule TEXT NOT NULL DEFAULT '',
            reviewResult TEXT NOT NULL,
            reviewConclusion TEXT NOT NULL,
            executionAssessment TEXT NOT NULL DEFAULT '',
            deviationReason TEXT NOT NULL DEFAULT '',
            resultAttribution TEXT NOT NULL DEFAULT '',
            nextAction TEXT NOT NULL DEFAULT '',
            reviewStatus TEXT NOT NULL DEFAULT 'pending',
            tags TEXT NOT NULL,
            remarks TEXT NOT NULL,
            importNotes TEXT NOT NULL,
            sourceType TEXT NOT NULL DEFAULT 'manual',
            sourceLabel TEXT NOT NULL DEFAULT '手动录入',
            lastModifiedAt TEXT NOT NULL DEFAULT '',
            lastModifiedType TEXT NOT NULL DEFAULT 'created',
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
            sourceType TEXT NOT NULL DEFAULT 'manual',
            sourceLabel TEXT NOT NULL DEFAULT '手动事件',
            lastModifiedAt TEXT NOT NULL DEFAULT '',
            lastModifiedType TEXT NOT NULL DEFAULT 'created',
            createdAt TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS price_snapshots (
            id TEXT PRIMARY KEY,
            positionId TEXT NOT NULL,
            snapshotAt TEXT NOT NULL,
            underlyingPrice REAL,
            legMarks TEXT NOT NULL,
            note TEXT NOT NULL,
            sourceType TEXT NOT NULL DEFAULT 'manual',
            sourceLabel TEXT NOT NULL DEFAULT '手动估值',
            lastModifiedAt TEXT NOT NULL DEFAULT '',
            lastModifiedType TEXT NOT NULL DEFAULT 'created',
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


def _apply_migrations(connection: sqlite3.Connection) -> None:
    for name, sql in [
        ("riskNotes", "TEXT NOT NULL DEFAULT ''"),
        ("exitRule", "TEXT NOT NULL DEFAULT ''"),
        ("executionAssessment", "TEXT NOT NULL DEFAULT ''"),
        ("deviationReason", "TEXT NOT NULL DEFAULT ''"),
        ("resultAttribution", "TEXT NOT NULL DEFAULT ''"),
        ("nextAction", "TEXT NOT NULL DEFAULT ''"),
        ("reviewStatus", "TEXT NOT NULL DEFAULT 'pending'"),
        ("sourceType", "TEXT NOT NULL DEFAULT 'manual'"),
        ("sourceLabel", "TEXT NOT NULL DEFAULT '手动录入'"),
        ("lastModifiedAt", "TEXT NOT NULL DEFAULT ''"),
        ("lastModifiedType", "TEXT NOT NULL DEFAULT 'created'"),
    ]:
        _ensure_column(connection, "positions", name, sql)

    for name, sql in [
        ("sourceType", "TEXT NOT NULL DEFAULT 'manual'"),
        ("sourceLabel", "TEXT NOT NULL DEFAULT '手动事件'"),
        ("lastModifiedAt", "TEXT NOT NULL DEFAULT ''"),
        ("lastModifiedType", "TEXT NOT NULL DEFAULT 'created'"),
    ]:
        _ensure_column(connection, "events", name, sql)

    for name, sql in [
        ("sourceType", "TEXT NOT NULL DEFAULT 'manual'"),
        ("sourceLabel", "TEXT NOT NULL DEFAULT '手动估值'"),
        ("lastModifiedAt", "TEXT NOT NULL DEFAULT ''"),
        ("lastModifiedType", "TEXT NOT NULL DEFAULT 'created'"),
    ]:
        _ensure_column(connection, "price_snapshots", name, sql)

    connection.execute(
        "INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)",
        ("schema_version", str(SCHEMA_VERSION)),
    )


def init_db() -> None:
    with storage_lock:
        connection = _connect()
        try:
            _create_tables(connection)
            _apply_migrations(connection)
            connection.commit()
        finally:
            connection.close()


def _row_value(row: sqlite3.Row, key: str, fallback: Any = None) -> Any:
    return row[key] if key in row.keys() else fallback


def _audit_from_row(row: sqlite3.Row, source_type: str, source_label: str) -> AuditStamp:
    return AuditStamp(
        sourceType=_row_value(row, "sourceType", source_type),
        sourceLabel=_row_value(row, "sourceLabel", source_label),
        lastModifiedAt=_row_value(row, "lastModifiedAt", _row_value(row, "createdAt", "")),
        lastModifiedType=_row_value(row, "lastModifiedType", "created"),
    )


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
        riskNotes=_row_value(row, "riskNotes", ""),
        exitRule=_row_value(row, "exitRule", ""),
        reviewResult=row["reviewResult"],
        reviewConclusion=row["reviewConclusion"],
        executionAssessment=_row_value(row, "executionAssessment", ""),
        deviationReason=_row_value(row, "deviationReason", ""),
        resultAttribution=_row_value(row, "resultAttribution", ""),
        nextAction=_row_value(row, "nextAction", ""),
        reviewStatus=_row_value(row, "reviewStatus", "pending"),
        tags=json_loads(row["tags"], []),
        remarks=row["remarks"],
        importNotes=json_loads(row["importNotes"], []),
        audit=_audit_from_row(row, "manual", "手动录入"),
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
        audit=_audit_from_row(row, "manual", "手动事件"),
        createdAt=row["createdAt"],
    )


def _snapshot_from_row(row: sqlite3.Row) -> PriceSnapshot:
    auto_close = "[AUTO_CLOSE:" in row["note"]
    return PriceSnapshot(
        id=row["id"],
        positionId=row["positionId"],
        snapshotAt=row["snapshotAt"],
        underlyingPrice=row["underlyingPrice"],
        legMarks=[PriceMark.model_validate(item) for item in json_loads(row["legMarks"], [])],
        note=row["note"],
        audit=_audit_from_row(row, "auto_close" if auto_close else "manual", "自动收盘快照" if auto_close else "手动估值"),
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


def _workflow(position: StrategyPosition, legs: list[StrategyLeg], events: list[PositionEvent], snapshots: list[PriceSnapshot]) -> WorkflowState:
    has_issue = False
    try:
        states = calculate_leg_states(legs, events, strict=True)
    except AppError:
        states = calculate_leg_states(legs, events)
        has_issue = True
    active_legs = [leg for leg in legs if states.get(leg.id) and states[leg.id].current_qty > 0]
    latest_snapshot_at = max([item.snapshotAt for item in snapshots], default=None)
    return WorkflowState(
        needsReview=position.status == "closed" and derive_review_status(position) != "reviewed",
        needsManualValuation=position.status == "open" and (any(leg.instrumentType == "option" for leg in active_legs) or latest_snapshot_at is None),
        hasDataIssue=has_issue or not legs or not events,
        daysSinceLastUpdate=days_since(position.updatedAt),
    )


def _fetch_all(connection: sqlite3.Connection) -> TradeDataBundle:
    positions = [_position_from_row(row) for row in connection.execute("SELECT * FROM positions ORDER BY openedAt DESC, createdAt DESC")]
    legs = [_leg_from_row(row) for row in connection.execute("SELECT * FROM legs ORDER BY createdAt DESC")]
    events = [_event_from_row(row) for row in connection.execute("SELECT * FROM events ORDER BY occurredAt DESC, createdAt DESC")]
    snapshots = [_snapshot_from_row(row) for row in connection.execute("SELECT * FROM price_snapshots ORDER BY snapshotAt DESC, createdAt DESC")]
    stats = [_stat_from_row(row) for row in connection.execute("SELECT * FROM stats ORDER BY date DESC")]
    legs_by_position: dict[str, list[StrategyLeg]] = {}
    events_by_position: dict[str, list[PositionEvent]] = {}
    snapshots_by_position: dict[str, list[PriceSnapshot]] = {}
    for leg in legs:
        legs_by_position.setdefault(leg.positionId, []).append(leg)
    for event in events:
        events_by_position.setdefault(event.positionId, []).append(event)
    for snapshot in snapshots:
        snapshots_by_position.setdefault(snapshot.positionId, []).append(snapshot)
    hydrated = [
        position.model_copy(
            update={
                "reviewStatus": derive_review_status(position),
                "workflowState": _workflow(position, legs_by_position.get(position.id, []), events_by_position.get(position.id, []), snapshots_by_position.get(position.id, [])),
            }
        )
        for position in positions
    ]
    return TradeDataBundle(positions=hydrated, legs=legs, events=events, priceSnapshots=snapshots, stats=stats)


def get_trade_bundle() -> TradeDataBundle:
    with storage_lock:
        connection = _connect()
        try:
            return _fetch_all(connection)
        finally:
            connection.close()


def _audit(source_type: str, source_label: str, mutation_type: str, at: str | None = None) -> AuditStamp:
    return AuditStamp(
        sourceType=source_type,
        sourceLabel=source_label,
        lastModifiedAt=at or now_iso(),
        lastModifiedType=mutation_type,
    )


def _create_position_record(input_data: StrategyPositionInput, source_type: str, source_label: str, mutation_type: str) -> StrategyPosition:
    timestamp = now_iso()
    position = StrategyPosition(
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
        riskNotes=input_data.riskNotes.strip(),
        exitRule=input_data.exitRule.strip(),
        reviewResult=input_data.reviewResult.strip(),
        reviewConclusion=input_data.reviewConclusion.strip(),
        executionAssessment=input_data.executionAssessment.strip(),
        deviationReason=input_data.deviationReason.strip(),
        resultAttribution=input_data.resultAttribution.strip(),
        nextAction=input_data.nextAction.strip(),
        reviewStatus=input_data.reviewStatus,
        tags=[tag.strip() for tag in input_data.tags if tag.strip()],
        remarks=input_data.remarks.strip(),
        importNotes=input_data.importNotes or [],
        audit=_audit(source_type, source_label, mutation_type, timestamp),
        createdAt=timestamp,
        updatedAt=timestamp,
        latestSnapshotAt=None,
    )
    return position.model_copy(update={"reviewStatus": derive_review_status(position)})


def _create_leg_records(
    position_id: str,
    occurred_at: str,
    legs: list[StrategyLegInput],
    id_overrides: list[str] | None = None,
    created_overrides: list[str | None] | None = None,
) -> list[StrategyLeg]:
    rows: list[StrategyLeg] = []
    for index, leg in enumerate(legs):
        row_id = id_overrides[index] if id_overrides and index < len(id_overrides) else leg.id
        created_at = created_overrides[index] if created_overrides and index < len(created_overrides) else leg.createdAt
        rows.append(
            StrategyLeg(
                id=row_id or str(uuid.uuid4()),
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
                createdAt=created_at or occurred_at,
                note=(leg.note or "").strip() or None,
            )
        )
    return rows


def _insert_position(cursor: sqlite3.Cursor, position: StrategyPosition) -> None:
    cursor.execute(
        """
        INSERT INTO positions (
            id, accountType, product, underlyingSymbol, strategyName, openedAt, status, thesis, plan,
            expectedScenario, riskNotes, exitRule, reviewResult, reviewConclusion, executionAssessment,
            deviationReason, resultAttribution, nextAction, reviewStatus, tags, remarks, importNotes,
            sourceType, sourceLabel, lastModifiedAt, lastModifiedType, createdAt, updatedAt, latestSnapshotAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            position.id, position.accountType, position.product, position.underlyingSymbol, position.strategyName,
            position.openedAt, position.status, position.thesis, position.plan, position.expectedScenario,
            position.riskNotes, position.exitRule, position.reviewResult, position.reviewConclusion,
            position.executionAssessment, position.deviationReason, position.resultAttribution, position.nextAction,
            position.reviewStatus, json_dumps(position.tags), position.remarks, json_dumps(position.importNotes),
            position.audit.sourceType, position.audit.sourceLabel, position.audit.lastModifiedAt,
            position.audit.lastModifiedType, position.createdAt, position.updatedAt, position.latestSnapshotAt,
        ),
    )


def _update_position(cursor: sqlite3.Cursor, position: StrategyPosition) -> None:
    cursor.execute(
        """
        UPDATE positions
        SET status = ?, thesis = ?, plan = ?, expectedScenario = ?, riskNotes = ?, exitRule = ?,
            reviewResult = ?, reviewConclusion = ?, executionAssessment = ?, deviationReason = ?,
            resultAttribution = ?, nextAction = ?, reviewStatus = ?, tags = ?, remarks = ?,
            sourceType = ?, sourceLabel = ?, lastModifiedAt = ?, lastModifiedType = ?, updatedAt = ?, latestSnapshotAt = ?
        WHERE id = ?
        """,
        (
            position.status, position.thesis, position.plan, position.expectedScenario, position.riskNotes,
            position.exitRule, position.reviewResult, position.reviewConclusion, position.executionAssessment,
            position.deviationReason, position.resultAttribution, position.nextAction, position.reviewStatus,
            json_dumps(position.tags), position.remarks, position.audit.sourceType, position.audit.sourceLabel,
            position.audit.lastModifiedAt, position.audit.lastModifiedType, position.updatedAt,
            position.latestSnapshotAt, position.id,
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
            leg.id, leg.positionId, leg.instrumentType, leg.side, leg.contractCode, leg.optionType,
            leg.strikePrice, leg.expiryDate, leg.qty, leg.entryPrice, leg.multiplier, leg.createdAt, leg.note,
        ),
    )


def _upsert_leg(cursor: sqlite3.Cursor, leg: StrategyLeg) -> None:
    if cursor.execute("SELECT id FROM legs WHERE id = ?", (leg.id,)).fetchone():
        cursor.execute(
            """
            UPDATE legs
            SET instrumentType = ?, side = ?, contractCode = ?, optionType = ?, strikePrice = ?,
                expiryDate = ?, qty = ?, entryPrice = ?, multiplier = ?, createdAt = ?, note = ?
            WHERE id = ?
            """,
            (
                leg.instrumentType, leg.side, leg.contractCode, leg.optionType, leg.strikePrice,
                leg.expiryDate, leg.qty, leg.entryPrice, leg.multiplier, leg.createdAt, leg.note, leg.id,
            ),
        )
    else:
        _insert_leg(cursor, leg)


def _insert_event(cursor: sqlite3.Cursor, event: PositionEvent) -> None:
    cursor.execute(
        """
        INSERT INTO events (
            id, positionId, eventType, occurredAt, note, legChanges, newLegIds, isInitial,
            sourceType, sourceLabel, lastModifiedAt, lastModifiedType, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event.id, event.positionId, event.eventType, event.occurredAt, event.note,
            json_dumps([item.model_dump() for item in event.legChanges]), json_dumps(event.newLegIds),
            1 if event.isInitial else 0 if event.isInitial is not None else None,
            event.audit.sourceType, event.audit.sourceLabel, event.audit.lastModifiedAt,
            event.audit.lastModifiedType, event.createdAt,
        ),
    )


def _update_event(cursor: sqlite3.Cursor, event: PositionEvent) -> None:
    cursor.execute(
        """
        UPDATE events
        SET eventType = ?, occurredAt = ?, note = ?, legChanges = ?, newLegIds = ?, sourceType = ?, sourceLabel = ?,
            lastModifiedAt = ?, lastModifiedType = ?
        WHERE id = ?
        """,
        (
            event.eventType, event.occurredAt, event.note,
            json_dumps([item.model_dump() for item in event.legChanges]), json_dumps(event.newLegIds),
            event.audit.sourceType, event.audit.sourceLabel, event.audit.lastModifiedAt,
            event.audit.lastModifiedType, event.id,
        ),
    )


def _insert_snapshot(cursor: sqlite3.Cursor, snapshot: PriceSnapshot) -> None:
    cursor.execute(
        """
        INSERT INTO price_snapshots (
            id, positionId, snapshotAt, underlyingPrice, legMarks, note, sourceType, sourceLabel,
            lastModifiedAt, lastModifiedType, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot.id, snapshot.positionId, snapshot.snapshotAt, snapshot.underlyingPrice,
            json_dumps([item.model_dump() for item in snapshot.legMarks]), snapshot.note,
            snapshot.audit.sourceType, snapshot.audit.sourceLabel, snapshot.audit.lastModifiedAt,
            snapshot.audit.lastModifiedType, snapshot.createdAt,
        ),
    )


def _update_snapshot(cursor: sqlite3.Cursor, snapshot: PriceSnapshot) -> None:
    cursor.execute(
        """
        UPDATE price_snapshots
        SET snapshotAt = ?, underlyingPrice = ?, legMarks = ?, note = ?, sourceType = ?, sourceLabel = ?,
            lastModifiedAt = ?, lastModifiedType = ?
        WHERE id = ?
        """,
        (
            snapshot.snapshotAt, snapshot.underlyingPrice, json_dumps([item.model_dump() for item in snapshot.legMarks]),
            snapshot.note, snapshot.audit.sourceType, snapshot.audit.sourceLabel, snapshot.audit.lastModifiedAt,
            snapshot.audit.lastModifiedType, snapshot.id,
        ),
    )


def _insert_stat(cursor: sqlite3.Cursor, stat: DailyStat) -> None:
    cursor.execute(
        """
        INSERT OR REPLACE INTO stats (
            id, date, sourceLabel, principal, equity, returnRatio, cashFlow, profit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (stat.id, stat.date, stat.sourceLabel, stat.principal, stat.equity, stat.returnRatio, stat.cashFlow, stat.profit),
    )


def _get_row(connection: sqlite3.Connection, table: str, row_id: str) -> sqlite3.Row:
    row = connection.execute(f"SELECT * FROM {table} WHERE id = ?", (row_id,)).fetchone()
    ensure(row is not None, f"{table[:-1]}_not_found", "没有找到对应记录", 404)
    return row


def _load_position_records(connection: sqlite3.Connection, position_id: str) -> tuple[StrategyPosition, list[StrategyLeg], list[PositionEvent], list[PriceSnapshot]]:
    position = _position_from_row(_get_row(connection, "positions", position_id))
    legs = [_leg_from_row(row) for row in connection.execute("SELECT * FROM legs WHERE positionId = ? ORDER BY createdAt ASC", (position_id,))]
    events = [_event_from_row(row) for row in connection.execute("SELECT * FROM events WHERE positionId = ? ORDER BY occurredAt ASC, createdAt ASC", (position_id,))]
    snapshots = [_snapshot_from_row(row) for row in connection.execute("SELECT * FROM price_snapshots WHERE positionId = ? ORDER BY snapshotAt ASC, createdAt ASC", (position_id,))]
    return position, legs, events, snapshots


def _refresh_position(cursor: sqlite3.Cursor, position: StrategyPosition, legs: list[StrategyLeg], events: list[PositionEvent], snapshots: list[PriceSnapshot], mutation_type: str) -> StrategyPosition:
    updated = position.model_copy(
        update={
            "status": infer_position_status(legs, events),
            "reviewStatus": derive_review_status(position),
            "latestSnapshotAt": max([item.snapshotAt for item in snapshots], default=None),
            "updatedAt": now_iso(),
            "audit": position.audit.model_copy(update={"lastModifiedAt": now_iso(), "lastModifiedType": mutation_type}),
        }
    )
    _update_position(cursor, updated)
    return updated


def _write_auto_backup(connection: sqlite3.Connection, reason: str) -> None:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    bundle = _fetch_all(connection)
    payload = BackupPayload(version=2, exportedAt=now_iso(), positions=bundle.positions, legs=bundle.legs, events=bundle.events, priceSnapshots=bundle.priceSnapshots, stats=bundle.stats)
    path = BACKUP_DIR / f"auto-backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{reason}.json"
    path.write_text(json.dumps(payload.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
    for old_path in sorted(BACKUP_DIR.glob("auto-backup-*.json"))[:-30]:
        old_path.unlink(missing_ok=True)


def _validate_event_timing(position: StrategyPosition, occurred_at: str) -> None:
    ensure(occurred_at >= position.openedAt, "event_before_open", "仓位事件日期不能早于开仓日期")


def _validate_event_direction(event_type: str, changes: list[LegChange]) -> None:
    for change in changes:
        if event_type == "add":
            ensure(change.quantityChange > 0, "invalid_event_direction", "加仓事件的数量变动必须为正数")
        if event_type in {"reduce", "close"}:
            ensure(change.quantityChange < 0, "invalid_event_direction", "减仓或平仓事件的数量变动必须为负数")


def _validate_snapshot_unique(connection: sqlite3.Connection, position_id: str, snapshot_at: str, ignore_snapshot_id: str | None = None) -> None:
    existing = connection.execute(
        "SELECT id FROM price_snapshots WHERE positionId = ? AND snapshotAt = ? AND (? IS NULL OR id <> ?) LIMIT 1",
        (position_id, snapshot_at, ignore_snapshot_id, ignore_snapshot_id),
    ).fetchone()
    ensure(existing is None, "duplicate_snapshot_date", "同一笔交易的估值日期不能重复")


def _simulate(position: StrategyPosition, legs: list[StrategyLeg], events: list[PositionEvent], remove_event_id: str | None = None, replacement_event: PositionEvent | None = None, remove_leg_ids: set[str] | None = None, replacement_legs: list[StrategyLeg] | None = None) -> None:
    candidate_legs = [leg for leg in legs if not remove_leg_ids or leg.id not in remove_leg_ids]
    if replacement_legs:
        replacement_map = {leg.id: leg for leg in replacement_legs}
        candidate_legs = [replacement_map.pop(leg.id, leg) for leg in candidate_legs]
        candidate_legs.extend(replacement_map.values())
    candidate_events = [event for event in events if event.id != remove_event_id]
    if replacement_event is not None:
        candidate_events.append(replacement_event)
        _validate_event_timing(position, replacement_event.occurredAt)
    calculate_leg_states(candidate_legs, candidate_events, strict=True)


def create_strategy_position(input_data: StrategyPositionInput) -> str:
    position = _create_position_record(input_data, "manual", "手动录入", "created")
    legs = _create_leg_records(position.id, input_data.openedAt, input_data.legs)
    event = PositionEvent(
        id=str(uuid.uuid4()),
        positionId=position.id,
        eventType="open",
        occurredAt=input_data.openedAt,
        note=input_data.remarks.strip() or "初始开仓",
        legChanges=[LegChange(legId=leg.id, quantityChange=leg.qty, price=leg.entryPrice, note=leg.note) for leg in legs],
        newLegIds=[leg.id for leg in legs],
        isInitial=True,
        audit=_audit("manual", "手动开仓", "created"),
        createdAt=now_iso(),
    )
    calculate_leg_states(legs, [event], strict=True)
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            _insert_position(cursor, position)
            for leg in legs:
                _insert_leg(cursor, leg)
            _insert_event(cursor, event)
            connection.commit()
            _write_auto_backup(connection, "create-position")
        finally:
            connection.close()
    return position.id


def add_position_event(input_data: PositionEventInput) -> None:
    with storage_lock:
        connection = _connect()
        try:
            position, legs, events, snapshots = _load_position_records(connection, input_data.positionId)
            _validate_event_timing(position, input_data.occurredAt)
            _validate_event_direction(input_data.eventType, input_data.legChanges)
            created_legs = _create_leg_records(input_data.positionId, input_data.occurredAt, input_data.newLegs or [])
            event = PositionEvent(
                id=str(uuid.uuid4()),
                positionId=input_data.positionId,
                eventType=input_data.eventType,
                occurredAt=input_data.occurredAt,
                note=input_data.note.strip(),
                legChanges=input_data.legChanges,
                newLegIds=[leg.id for leg in created_legs],
                audit=_audit("manual", "手动事件", "created"),
                createdAt=now_iso(),
            )
            _simulate(position, legs, events, replacement_event=event, replacement_legs=created_legs)
            cursor = connection.cursor()
            for leg in created_legs:
                _insert_leg(cursor, leg)
            _insert_event(cursor, event)
            _refresh_position(cursor, position, legs + created_legs, events + [event], snapshots, "updated")
            connection.commit()
            _write_auto_backup(connection, "add-event")
        finally:
            connection.close()


def update_position_event(event_id: str, input_data: PositionEventUpdateInput) -> None:
    with storage_lock:
        connection = _connect()
        try:
            existing_event = _event_from_row(_get_row(connection, "events", event_id))
            ensure(not existing_event.isInitial, "initial_event_locked", "首次开仓事件不能直接编辑")
            position, legs, events, snapshots = _load_position_records(connection, existing_event.positionId)
            ensure(input_data.positionId == existing_event.positionId, "cross_position_event_update", "仓位事件不能移动到其他交易下")
            _validate_event_timing(position, input_data.occurredAt)
            _validate_event_direction(input_data.eventType, input_data.legChanges)
            old_new_legs = [leg for leg in legs if leg.id in existing_event.newLegIds]
            if input_data.newLegs is None:
                updated_new_legs = old_new_legs
            else:
                if existing_event.newLegIds:
                    ensure(len(input_data.newLegs) == len(existing_event.newLegIds), "event_new_legs_shape_changed", "当前版本只支持编辑原有新增腿的内容")
                updated_new_legs = _create_leg_records(
                    existing_event.positionId,
                    input_data.occurredAt,
                    input_data.newLegs,
                    id_overrides=[leg.id for leg in old_new_legs] or None,
                    created_overrides=[leg.createdAt for leg in old_new_legs] or None,
                )
            updated_event = PositionEvent(
                id=existing_event.id,
                positionId=existing_event.positionId,
                eventType=input_data.eventType,
                occurredAt=input_data.occurredAt,
                note=input_data.note.strip(),
                legChanges=input_data.legChanges,
                newLegIds=[leg.id for leg in updated_new_legs],
                isInitial=False,
                audit=existing_event.audit.model_copy(update={"lastModifiedAt": now_iso(), "lastModifiedType": "updated"}),
                createdAt=existing_event.createdAt,
            )
            _simulate(position, legs, events, remove_event_id=existing_event.id, replacement_event=updated_event, replacement_legs=updated_new_legs)
            cursor = connection.cursor()
            for leg in updated_new_legs:
                _upsert_leg(cursor, leg)
            _update_event(cursor, updated_event)
            next_events = [event for event in events if event.id != existing_event.id] + [updated_event]
            next_legs = [leg for leg in legs if leg.id not in existing_event.newLegIds] + updated_new_legs
            _refresh_position(cursor, position, next_legs, next_events, snapshots, "updated")
            connection.commit()
            _write_auto_backup(connection, "update-event")
        finally:
            connection.close()


def delete_position_event(event_id: str) -> None:
    with storage_lock:
        connection = _connect()
        try:
            event = _event_from_row(_get_row(connection, "events", event_id))
            ensure(not event.isInitial, "initial_event_locked", "首次开仓事件不能删除")
            position, legs, events, snapshots = _load_position_records(connection, event.positionId)
            removed_leg_ids = set(event.newLegIds)
            if removed_leg_ids:
                later_event_ref = any(event_item.id != event.id and any(change.legId in removed_leg_ids for change in event_item.legChanges) for event_item in events)
                snapshot_ref = any(any(mark.legId in removed_leg_ids for mark in snapshot.legMarks) for snapshot in snapshots)
                ensure(not later_event_ref and not snapshot_ref, "event_delete_blocked", "该事件新增的持仓已被后续事件或估值引用，无法删除")
            _simulate(position, legs, events, remove_event_id=event.id, remove_leg_ids=removed_leg_ids)
            cursor = connection.cursor()
            cursor.execute("DELETE FROM events WHERE id = ?", (event.id,))
            for leg_id in removed_leg_ids:
                cursor.execute("DELETE FROM legs WHERE id = ?", (leg_id,))
            next_events = [item for item in events if item.id != event.id]
            next_legs = [item for item in legs if item.id not in removed_leg_ids]
            _refresh_position(cursor, position, next_legs, next_events, snapshots, "updated")
            connection.commit()
            _write_auto_backup(connection, "delete-event")
        finally:
            connection.close()


def save_price_snapshot(input_data: PriceSnapshotInput, source_type: str = "manual", source_label: str = "手动估值", mutation_type: str = "created") -> None:
    snapshot = PriceSnapshot(
        id=str(uuid.uuid4()),
        positionId=input_data.positionId,
        snapshotAt=input_data.snapshotAt,
        underlyingPrice=input_data.underlyingPrice,
        legMarks=input_data.legMarks,
        note=input_data.note.strip(),
        audit=_audit(source_type, source_label, mutation_type),
        createdAt=now_iso(),
    )
    with storage_lock:
        connection = _connect()
        try:
            position, legs, events, snapshots = _load_position_records(connection, input_data.positionId)
            _validate_snapshot_unique(connection, input_data.positionId, input_data.snapshotAt)
            cursor = connection.cursor()
            _insert_snapshot(cursor, snapshot)
            _refresh_position(cursor, position, legs, events, snapshots + [snapshot], "updated")
            connection.commit()
            _write_auto_backup(connection, "create-snapshot")
        finally:
            connection.close()


def update_price_snapshot(snapshot_id: str, input_data: PriceSnapshotUpdateInput) -> None:
    with storage_lock:
        connection = _connect()
        try:
            snapshot = _snapshot_from_row(_get_row(connection, "price_snapshots", snapshot_id))
            ensure(snapshot.audit.sourceType != "auto_close", "auto_snapshot_locked", "自动收盘快照不能直接编辑")
            ensure(input_data.positionId == snapshot.positionId, "cross_position_snapshot_update", "估值记录不能移动到其他交易下")
            position, legs, events, snapshots = _load_position_records(connection, snapshot.positionId)
            _validate_snapshot_unique(connection, snapshot.positionId, input_data.snapshotAt, ignore_snapshot_id=snapshot_id)
            updated_snapshot = snapshot.model_copy(
                update={
                    "snapshotAt": input_data.snapshotAt,
                    "underlyingPrice": input_data.underlyingPrice,
                    "legMarks": input_data.legMarks,
                    "note": input_data.note.strip(),
                    "audit": snapshot.audit.model_copy(update={"lastModifiedAt": now_iso(), "lastModifiedType": "updated"}),
                }
            )
            cursor = connection.cursor()
            _update_snapshot(cursor, updated_snapshot)
            next_snapshots = [item for item in snapshots if item.id != snapshot.id] + [updated_snapshot]
            _refresh_position(cursor, position, legs, events, next_snapshots, "updated")
            connection.commit()
            _write_auto_backup(connection, "update-snapshot")
        finally:
            connection.close()


def delete_price_snapshot(snapshot_id: str) -> None:
    with storage_lock:
        connection = _connect()
        try:
            snapshot = _snapshot_from_row(_get_row(connection, "price_snapshots", snapshot_id))
            ensure(snapshot.audit.sourceType != "auto_close", "auto_snapshot_locked", "自动收盘快照不能直接删除")
            position, legs, events, snapshots = _load_position_records(connection, snapshot.positionId)
            cursor = connection.cursor()
            cursor.execute("DELETE FROM price_snapshots WHERE id = ?", (snapshot.id,))
            next_snapshots = [item for item in snapshots if item.id != snapshot.id]
            _refresh_position(cursor, position, legs, events, next_snapshots, "updated")
            connection.commit()
            _write_auto_backup(connection, "delete-snapshot")
        finally:
            connection.close()


def save_close_snapshot_with_signature(input_data: PriceSnapshotInput, signature: str) -> bool:
    with storage_lock:
        connection = _connect()
        try:
            existing = connection.execute(
                "SELECT id FROM price_snapshots WHERE positionId = ? AND note LIKE ? LIMIT 1",
                (input_data.positionId, f"%[AUTO_CLOSE:{signature}]%"),
            ).fetchone()
            if existing:
                return False
            position, legs, events, snapshots = _load_position_records(connection, input_data.positionId)
            snapshot = PriceSnapshot(
                id=str(uuid.uuid4()),
                positionId=input_data.positionId,
                snapshotAt=input_data.snapshotAt,
                underlyingPrice=input_data.underlyingPrice,
                legMarks=input_data.legMarks,
                note=f"{input_data.note}\n[AUTO_CLOSE:{signature}]",
                audit=_audit("auto_close", "鑷姩鏀剁洏蹇収", "auto_close"),
                createdAt=now_iso(),
            )
            _validate_snapshot_unique(connection, input_data.positionId, input_data.snapshotAt)
            cursor = connection.cursor()
            _insert_snapshot(cursor, snapshot)
            _refresh_position(cursor, position, legs, events, snapshots + [snapshot], "auto_close")
            connection.commit()
            _write_auto_backup(connection, "auto-close-snapshot")
            return True
            save_price_snapshot(
                PriceSnapshotInput(
                    positionId=input_data.positionId,
                    snapshotAt=input_data.snapshotAt,
                    underlyingPrice=input_data.underlyingPrice,
                    legMarks=input_data.legMarks,
                    note=f"{input_data.note}\n[AUTO_CLOSE:{signature}]",
                ),
                source_type="auto_close",
                source_label="自动收盘快照",
                mutation_type="auto_close",
            )
            return True
        finally:
            connection.close()


def update_position_review(position_id: str, review: ReviewUpdateInput) -> None:
    with storage_lock:
        connection = _connect()
        try:
            position, legs, events, snapshots = _load_position_records(connection, position_id)
            updated_position = position.model_copy(
                update={
                    "thesis": review.thesis.strip(),
                    "plan": review.plan.strip(),
                    "expectedScenario": review.expectedScenario.strip(),
                    "riskNotes": review.riskNotes.strip(),
                    "exitRule": review.exitRule.strip(),
                    "reviewResult": review.reviewResult.strip(),
                    "reviewConclusion": review.reviewConclusion.strip(),
                    "executionAssessment": review.executionAssessment.strip(),
                    "deviationReason": review.deviationReason.strip(),
                    "resultAttribution": review.resultAttribution.strip(),
                    "nextAction": review.nextAction.strip(),
                    "reviewStatus": review.reviewStatus or derive_review_status(position.model_copy(update={
                        "reviewResult": review.reviewResult.strip(),
                        "reviewConclusion": review.reviewConclusion.strip(),
                        "executionAssessment": review.executionAssessment.strip(),
                        "resultAttribution": review.resultAttribution.strip(),
                        "nextAction": review.nextAction.strip(),
                    }), prefer_explicit=False),
                    "remarks": review.remarks.strip(),
                    "tags": [tag.strip() for tag in review.tags if tag.strip()],
                    "updatedAt": now_iso(),
                    "audit": position.audit.model_copy(update={"lastModifiedAt": now_iso(), "lastModifiedType": "updated"}),
                }
            )
            cursor = connection.cursor()
            _update_position(cursor, updated_position)
            _refresh_position(cursor, updated_position, legs, events, snapshots, "updated")
            connection.commit()
            _write_auto_backup(connection, "update-review")
        finally:
            connection.close()


def save_import_batch(positions: list[StrategyPositionInput], stats: list[DailyStat]) -> None:
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            for input_data in positions:
                position = _create_position_record(input_data, "import", "Excel 导入", "imported")
                legs = _create_leg_records(position.id, input_data.openedAt, input_data.legs)
                event = PositionEvent(
                    id=str(uuid.uuid4()),
                    positionId=position.id,
                    eventType="open",
                    occurredAt=input_data.openedAt,
                    note=input_data.remarks.strip() or "从 Excel 导入",
                    legChanges=[LegChange(legId=leg.id, quantityChange=leg.qty, price=leg.entryPrice, note=leg.note) for leg in legs],
                    newLegIds=[leg.id for leg in legs],
                    isInitial=True,
                    audit=_audit("import", "Excel 导入事件", "imported"),
                    createdAt=now_iso(),
                )
                _insert_position(cursor, position)
                for leg in legs:
                    _insert_leg(cursor, leg)
                _insert_event(cursor, event)
            for stat in stats:
                _insert_stat(cursor, stat)
            connection.commit()
            _write_auto_backup(connection, "import-batch")
        finally:
            connection.close()


def export_backup_payload() -> BackupPayload:
    bundle = get_trade_bundle()
    return BackupPayload(version=2, exportedAt=now_iso(), positions=bundle.positions, legs=bundle.legs, events=bundle.events, priceSnapshots=bundle.priceSnapshots, stats=bundle.stats)


def clear_all_data() -> None:
    with storage_lock:
        connection = _connect()
        try:
            if connection.execute("SELECT COUNT(*) AS count FROM positions").fetchone()["count"]:
                _write_auto_backup(connection, "before-clear")
            cursor = connection.cursor()
            for table in ["positions", "legs", "events", "price_snapshots", "stats"]:
                cursor.execute(f"DELETE FROM {table}")
            connection.commit()
        finally:
            connection.close()


def restore_backup_payload(payload: BackupPayload) -> None:
    with storage_lock:
        connection = _connect()
        try:
            cursor = connection.cursor()
            for table in ["positions", "legs", "events", "price_snapshots", "stats"]:
                cursor.execute(f"DELETE FROM {table}")
            for position in payload.positions:
                _insert_position(cursor, position.model_copy(update={"audit": _audit("restore", "备份恢复", "restored"), "updatedAt": now_iso()}))
            for leg in payload.legs:
                _insert_leg(cursor, leg)
            for event in payload.events:
                _insert_event(cursor, event.model_copy(update={"audit": _audit("restore", "备份恢复", "restored")}))
            for snapshot in payload.priceSnapshots:
                _insert_snapshot(cursor, snapshot.model_copy(update={"audit": _audit("restore", "备份恢复", "restored")}))
            for stat in payload.stats:
                _insert_stat(cursor, stat)
            connection.commit()
            _write_auto_backup(connection, "restore")
        finally:
            connection.close()


def list_open_quote_positions() -> list[dict[str, Any]]:
    bundle = get_trade_bundle()
    legs_by_position: dict[str, list[StrategyLeg]] = {}
    events_by_position: dict[str, list[PositionEvent]] = {}
    for leg in bundle.legs:
        legs_by_position.setdefault(leg.positionId, []).append(leg)
    for event in bundle.events:
        events_by_position.setdefault(event.positionId, []).append(event)
    rows: list[dict[str, Any]] = []
    for position in bundle.positions:
        if position.status != "open":
            continue
        states = calculate_leg_states(legs_by_position.get(position.id, []), events_by_position.get(position.id, []))
        active_legs = [
            {
                "id": leg.id,
                "contractCode": leg.contractCode,
                "instrumentType": leg.instrumentType,
            }
            for leg in legs_by_position.get(position.id, [])
            if states.get(leg.id) and states[leg.id].current_qty > 0
        ]
        rows.append(
            {
                "positionId": position.id,
                "product": position.product,
                "underlyingSymbol": position.underlyingSymbol,
                "legs": active_legs,
            }
        )
    return rows
