from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from quote_service import storage
from quote_service.domain import calculate_leg_states
from quote_service.schemas import (
    DailyStat,
    LegChange,
    PositionEventInput,
    PositionEventUpdateInput,
    PriceMark,
    PriceSnapshotInput,
    PriceSnapshotUpdateInput,
    ReviewUpdateInput,
    StrategyLegInput,
    StrategyPositionInput,
)


def make_position_input() -> StrategyPositionInput:
    return StrategyPositionInput(
        accountType="live",
        product="股指",
        underlyingSymbol="IH2509",
        strategyName="测试交易",
        openedAt="2026-04-01",
        thesis="test thesis",
        plan="test plan",
        expectedScenario="test scenario",
        riskNotes="test risk",
        exitRule="test exit",
        tags=["test"],
        remarks="manual",
        legs=[
            StrategyLegInput(
                instrumentType="future",
                side="long",
                contractCode="IH2509",
                qty=2,
                entryPrice=100,
                multiplier=10,
            )
        ],
    )


class StorageTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.original_runtime = storage.RUNTIME_DIR
        self.original_backup = storage.BACKUP_DIR
        self.original_db = storage.DB_FILE
        self.test_token = next(tempfile._get_candidate_names())
        storage.RUNTIME_DIR = self.original_runtime
        storage.BACKUP_DIR = storage.RUNTIME_DIR / f"test-backups-{self.test_token}"
        storage.DB_FILE = storage.RUNTIME_DIR / f"trade_record-{self.test_token}.db"
        storage.init_db()

    def tearDown(self) -> None:
        storage.RUNTIME_DIR = self.original_runtime
        storage.BACKUP_DIR = self.original_backup
        storage.DB_FILE = self.original_db
        (self.original_runtime / f"trade_record-{self.test_token}.db").unlink(missing_ok=True)
        shutil.rmtree(self.original_runtime / f"test-backups-{self.test_token}", ignore_errors=True)

    def get_position_bundle(self, position_id: str):
        bundle = storage.get_trade_bundle()
        position = next(item for item in bundle.positions if item.id == position_id)
        legs = [item for item in bundle.legs if item.positionId == position_id]
        events = [item for item in bundle.events if item.positionId == position_id]
        snapshots = [item for item in bundle.priceSnapshots if item.positionId == position_id]
        return bundle, position, legs, events, snapshots

    def test_event_update_and_delete_recalculate_position(self) -> None:
        position_id = storage.create_strategy_position(make_position_input())
        bundle, _, legs, _, _ = self.get_position_bundle(position_id)
        leg = legs[0]

        storage.add_position_event(
            PositionEventInput(
                positionId=position_id,
                eventType="reduce",
                occurredAt="2026-04-02",
                note="trim",
                legChanges=[LegChange(legId=leg.id, quantityChange=-1, price=110)],
            )
        )

        _, position, legs, events, _ = self.get_position_bundle(position_id)
        state = calculate_leg_states(legs, events, strict=True)[leg.id]
        self.assertEqual(position.status, "open")
        self.assertEqual(state.current_qty, 1)
        self.assertEqual(state.realized_pnl, 100)

        editable_event = next(item for item in events if not item.isInitial)
        storage.update_position_event(
            editable_event.id,
            PositionEventUpdateInput(
                positionId=position_id,
                eventType="close",
                occurredAt="2026-04-02",
                note="full exit",
                legChanges=[LegChange(legId=leg.id, quantityChange=-2, price=115)],
            ),
        )

        _, position, legs, events, _ = self.get_position_bundle(position_id)
        state = calculate_leg_states(legs, events, strict=True)[leg.id]
        self.assertEqual(position.status, "closed")
        self.assertEqual(state.current_qty, 0)
        self.assertEqual(state.realized_pnl, 300)

        storage.delete_position_event(editable_event.id)
        _, position, legs, events, _ = self.get_position_bundle(position_id)
        state = calculate_leg_states(legs, events, strict=True)[leg.id]
        self.assertEqual(position.status, "open")
        self.assertEqual(state.current_qty, 2)
        self.assertEqual(state.realized_pnl, 0)

    def test_snapshot_create_update_delete(self) -> None:
        position_id = storage.create_strategy_position(make_position_input())
        _, _, legs, _, _ = self.get_position_bundle(position_id)
        leg = legs[0]

        storage.save_price_snapshot(
            PriceSnapshotInput(
                positionId=position_id,
                snapshotAt="2026-04-02",
                underlyingPrice=101,
                legMarks=[PriceMark(legId=leg.id, markPrice=102)],
                note="manual snapshot",
            )
        )

        _, position, _, _, snapshots = self.get_position_bundle(position_id)
        self.assertEqual(position.latestSnapshotAt, "2026-04-02")
        self.assertEqual(len(snapshots), 1)

        storage.update_price_snapshot(
            snapshots[0].id,
            PriceSnapshotUpdateInput(
                positionId=position_id,
                snapshotAt="2026-04-03",
                underlyingPrice=103,
                legMarks=[PriceMark(legId=leg.id, markPrice=104)],
                note="updated snapshot",
            ),
        )

        _, position, _, _, snapshots = self.get_position_bundle(position_id)
        self.assertEqual(position.latestSnapshotAt, "2026-04-03")
        self.assertEqual(snapshots[0].note, "updated snapshot")
        self.assertEqual(snapshots[0].legMarks[0].markPrice, 104)

        storage.delete_price_snapshot(snapshots[0].id)
        _, position, _, _, snapshots = self.get_position_bundle(position_id)
        self.assertIsNone(position.latestSnapshotAt)
        self.assertEqual(snapshots, [])

    def test_backup_restore_and_auto_close_deduplicate(self) -> None:
        position_id = storage.create_strategy_position(make_position_input())
        _, _, legs, _, _ = self.get_position_bundle(position_id)
        leg = legs[0]

        storage.save_price_snapshot(
            PriceSnapshotInput(
                positionId=position_id,
                snapshotAt="2026-04-02",
                underlyingPrice=101,
                legMarks=[PriceMark(legId=leg.id, markPrice=102)],
                note="manual snapshot",
            )
        )
        storage.save_import_batch(
            [],
            [
                DailyStat(
                    id="stat-1",
                    date="2026-04-02",
                    sourceLabel="manual",
                    principal=100000,
                    equity=101000,
                    returnRatio=0.01,
                    cashFlow=0,
                    profit=1000,
                )
            ],
        )

        payload = storage.export_backup_payload()
        self.assertEqual(len(payload.positions), 1)
        self.assertEqual(len(payload.stats), 1)

        storage.clear_all_data()
        bundle = storage.get_trade_bundle()
        self.assertEqual(bundle.positions, [])
        self.assertEqual(bundle.stats, [])

        storage.restore_backup_payload(payload)
        bundle, position, legs, events, snapshots = self.get_position_bundle(position_id)
        self.assertEqual(len(bundle.positions), 1)
        self.assertEqual(len(legs), 1)
        self.assertEqual(len(events), 1)
        self.assertEqual(len(snapshots), 1)
        self.assertEqual(len(bundle.stats), 1)
        self.assertEqual(position.audit.sourceType, "restore")

        saved = storage.save_close_snapshot_with_signature(
            PriceSnapshotInput(
                positionId=position_id,
                snapshotAt="2026-04-05T15:00:00",
                underlyingPrice=105,
                legMarks=[PriceMark(legId=legs[0].id, markPrice=106)],
                note="auto close",
            ),
            signature=f"2026-04-05:{position_id}",
        )
        duplicate = storage.save_close_snapshot_with_signature(
            PriceSnapshotInput(
                positionId=position_id,
                snapshotAt="2026-04-05T15:00:00",
                underlyingPrice=105,
                legMarks=[PriceMark(legId=legs[0].id, markPrice=106)],
                note="auto close",
            ),
            signature=f"2026-04-05:{position_id}",
        )

        self.assertTrue(saved)
        self.assertFalse(duplicate)
        bundle = storage.get_trade_bundle()
        self.assertEqual(len([item for item in bundle.priceSnapshots if item.positionId == position_id]), 2)
        self.assertTrue(any(storage.BACKUP_DIR.glob("auto-backup-*.json")))

    def test_review_status_auto_derives_from_structured_fields(self) -> None:
        position_id = storage.create_strategy_position(make_position_input())

        storage.update_position_review(
            position_id,
            ReviewUpdateInput(
                reviewResult="result",
                executionAssessment="execution",
            ),
        )
        bundle, position, _, _, _ = self.get_position_bundle(position_id)
        self.assertEqual(position.reviewStatus, "ready")

        storage.update_position_review(
            position_id,
            ReviewUpdateInput(
                thesis=position.thesis,
                plan=position.plan,
                expectedScenario=position.expectedScenario,
                riskNotes=position.riskNotes,
                exitRule=position.exitRule,
                reviewResult="result",
                reviewConclusion="conclusion",
                executionAssessment="execution",
                deviationReason="deviation",
                resultAttribution="attribution",
                nextAction="next",
                remarks="remark",
                tags=["reviewed"],
            ),
        )
        _, position, _, _, _ = self.get_position_bundle(position_id)
        self.assertEqual(position.reviewStatus, "reviewed")


if __name__ == "__main__":
    unittest.main()
