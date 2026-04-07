from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from math import isclose

from .errors import AppError
from .schemas import PositionEvent, ReviewStatus, StrategyLeg, StrategyPosition


@dataclass
class LegRuntimeState:
  leg: StrategyLeg
  signed_qty: float
  avg_cost: float
  realized_pnl: float = 0.0

  @property
  def current_qty(self) -> float:
    return abs(self.signed_qty)


def side_sign(side: StrategyLeg["side"]) -> int:
  return 1 if side == "long" else -1


def sorted_events(events: list[PositionEvent]) -> list[PositionEvent]:
  return sorted(events, key=lambda item: (item.occurredAt, item.createdAt, item.id))


def calculate_leg_states(
  legs: list[StrategyLeg],
  events: list[PositionEvent],
  *,
  strict: bool = False,
) -> dict[str, LegRuntimeState]:
  states: dict[str, LegRuntimeState] = {
    leg.id: LegRuntimeState(
      leg=leg,
      signed_qty=side_sign(leg.side) * leg.qty,
      avg_cost=leg.entryPrice,
    )
    for leg in legs
  }

  for event in sorted_events(events):
    if event.isInitial:
      continue

    for change in event.legChanges:
      state = states.get(change.legId)
      if state is None:
        if strict:
          raise AppError("missing_leg_reference", f"事件 {event.id} 引用了不存在的持仓明细")
        continue

      trade_qty = side_sign(state.leg.side) * change.quantityChange
      before = state.signed_qty
      after = before + trade_qty

      if strict and not isclose(before, 0.0):
        if not isclose(after, 0.0) and (before > 0) != (after > 0):
          raise AppError("over_close_leg", "本次平仓或减仓数量超过当前剩余持仓")

      if isclose(before, 0.0) or (before > 0) == (trade_qty > 0):
        current_abs = abs(before)
        trade_abs = abs(trade_qty)
        total_abs = current_abs + trade_abs
        state.avg_cost = change.price if isclose(total_abs, 0.0) else (
          (current_abs * state.avg_cost + trade_abs * change.price) / total_abs
        )
        state.signed_qty = after
        continue

      close_qty = min(abs(before), abs(trade_qty))
      state.realized_pnl += (
        close_qty
        * (change.price - state.avg_cost)
        * state.leg.multiplier
        * (1 if before > 0 else -1)
      )
      state.signed_qty = after

      if isclose(state.signed_qty, 0.0):
        state.signed_qty = 0.0
        state.avg_cost = 0.0
      elif (state.signed_qty > 0) == (trade_qty > 0):
        state.avg_cost = change.price

  return states


def infer_position_status(legs: list[StrategyLeg], events: list[PositionEvent]) -> str:
  states = calculate_leg_states(legs, events)
  total_qty = sum(state.current_qty for state in states.values())
  return "open" if total_qty > 0 else "closed"


def derive_review_status(
  position: StrategyPosition,
  *,
  prefer_explicit: bool = True,
) -> ReviewStatus:
  if prefer_explicit and position.reviewStatus in {"pending", "ready", "reviewed"}:
    return position.reviewStatus

  completed_fields = [
    position.reviewResult,
    position.reviewConclusion,
    position.executionAssessment,
    position.resultAttribution,
    position.nextAction,
  ]
  if all(item.strip() for item in completed_fields):
    return "reviewed"
  if any(item.strip() for item in completed_fields):
    return "ready"
  return "pending"


def days_since(timestamp: str, now: datetime | None = None) -> int:
  current = now or datetime.now()
  try:
    value = datetime.fromisoformat(timestamp)
  except ValueError:
    try:
      value = datetime.fromisoformat(f"{timestamp}T00:00:00")
    except ValueError:
      return 0

  delta = current.date() - value.date()
  return max(delta.days, 0)
