from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


AccountType = Literal["live", "paper"]
PositionStatus = Literal["open", "closed"]
InstrumentType = Literal["future", "option"]
LegSide = Literal["long", "short"]
OptionType = Literal["C", "P"]
PositionEventType = Literal["open", "add", "reduce", "close", "roll"]
PositionEventActionType = Literal["add", "reduce", "close", "roll"]
QuoteCoverageView = Literal["auto", "manual_required", "missing"]
LiveQuoteCoverageStatus = Literal["full", "partial", "none"]
ReviewStatus = Literal["pending", "ready", "reviewed"]
RecordSourceType = Literal["manual", "import", "auto_close", "restore"]
RecordMutationType = Literal["created", "updated", "imported", "auto_close", "restored"]

MAX_REASONABLE_PRICE = 1_000_000


def _validate_date_like(value: str, field_name: str) -> str:
  candidate = value.strip()
  if not candidate:
    raise ValueError(f"{field_name}不能为空")

  try:
    if "T" in candidate:
      datetime.fromisoformat(candidate)
    else:
      date.fromisoformat(candidate)
  except ValueError as error:
    raise ValueError(f"{field_name}格式无效") from error

  return candidate


def _validate_non_empty_text(value: str, field_name: str) -> str:
  candidate = value.strip()
  if not candidate:
    raise ValueError(f"{field_name}不能为空")
  return candidate


def _validate_price(value: float, field_name: str, allow_zero: bool = True) -> float:
  if value != value or value == float("inf") or value == float("-inf"):
    raise ValueError(f"{field_name}必须是有限数字")

  if value < 0 or (not allow_zero and value == 0):
    raise ValueError(f"{field_name}不能为负数")

  if value > MAX_REASONABLE_PRICE:
    raise ValueError(f"{field_name}明显异常，请确认后再录入")

  return value


class WorkflowState(BaseModel):
  needsReview: bool = False
  needsManualValuation: bool = False
  hasDataIssue: bool = False
  daysSinceLastUpdate: int = 0


class AuditStamp(BaseModel):
  sourceType: RecordSourceType = "manual"
  sourceLabel: str = "手动录入"
  lastModifiedAt: str = ""
  lastModifiedType: RecordMutationType = "created"


class StrategyLegInput(BaseModel):
  id: str | None = None
  instrumentType: InstrumentType
  side: LegSide
  contractCode: str
  optionType: OptionType | None = None
  strikePrice: float | None = None
  expiryDate: str | None = None
  qty: float
  entryPrice: float
  multiplier: float
  note: str | None = None
  createdAt: str | None = None

  @field_validator("contractCode")
  @classmethod
  def validate_contract_code(cls, value: str) -> str:
    return _validate_non_empty_text(value, "合约代码")

  @field_validator("qty")
  @classmethod
  def validate_qty(cls, value: float) -> float:
    if value <= 0:
      raise ValueError("数量必须大于 0")
    return value

  @field_validator("entryPrice")
  @classmethod
  def validate_entry_price(cls, value: float) -> float:
    return _validate_price(value, "开仓价")

  @field_validator("multiplier")
  @classmethod
  def validate_multiplier(cls, value: float) -> float:
    if value <= 0:
      raise ValueError("乘数必须大于 0")
    if value > 1_000_000:
      raise ValueError("乘数明显异常，请确认后再录入")
    return value

  @field_validator("strikePrice")
  @classmethod
  def validate_strike_price(cls, value: float | None) -> float | None:
    if value is None:
      return value
    return _validate_price(value, "行权价")

  @field_validator("expiryDate")
  @classmethod
  def validate_expiry_date(cls, value: str | None) -> str | None:
    if value is None or not value.strip():
      return None
    return _validate_date_like(value, "到期日")

  @field_validator("createdAt")
  @classmethod
  def validate_created_at(cls, value: str | None) -> str | None:
    if value is None or not value.strip():
      return None
    return _validate_date_like(value, "持仓创建时间")


class StrategyPositionInput(BaseModel):
  accountType: AccountType
  product: str
  underlyingSymbol: str
  strategyName: str
  openedAt: str
  thesis: str = ""
  plan: str = ""
  expectedScenario: str = ""
  riskNotes: str = ""
  exitRule: str = ""
  reviewResult: str = ""
  reviewConclusion: str = ""
  executionAssessment: str = ""
  deviationReason: str = ""
  resultAttribution: str = ""
  nextAction: str = ""
  reviewStatus: ReviewStatus = "pending"
  tags: list[str] = Field(default_factory=list)
  remarks: str = ""
  importNotes: list[str] | None = None
  legs: list[StrategyLegInput]

  @field_validator("product")
  @classmethod
  def validate_product(cls, value: str) -> str:
    return _validate_non_empty_text(value, "品种")

  @field_validator("underlyingSymbol")
  @classmethod
  def validate_underlying_symbol(cls, value: str) -> str:
    return _validate_non_empty_text(value, "标的合约")

  @field_validator("strategyName")
  @classmethod
  def validate_strategy_name(cls, value: str) -> str:
    return _validate_non_empty_text(value, "交易名称")

  @field_validator("openedAt")
  @classmethod
  def validate_opened_at(cls, value: str) -> str:
    return _validate_date_like(value, "开仓日期")

  @model_validator(mode="after")
  def validate_legs(self) -> "StrategyPositionInput":
    if not self.legs:
      raise ValueError("至少需要一条持仓明细")
    return self


class StrategyPosition(BaseModel):
  id: str
  accountType: AccountType
  product: str
  underlyingSymbol: str
  strategyName: str
  openedAt: str
  status: PositionStatus
  thesis: str
  plan: str
  expectedScenario: str
  riskNotes: str = ""
  exitRule: str = ""
  reviewResult: str
  reviewConclusion: str
  executionAssessment: str = ""
  deviationReason: str = ""
  resultAttribution: str = ""
  nextAction: str = ""
  reviewStatus: ReviewStatus = "pending"
  tags: list[str]
  remarks: str
  importNotes: list[str]
  audit: AuditStamp = Field(default_factory=AuditStamp)
  workflowState: WorkflowState = Field(default_factory=WorkflowState)
  createdAt: str
  updatedAt: str
  latestSnapshotAt: str | None = None


class StrategyLeg(BaseModel):
  id: str
  positionId: str
  instrumentType: InstrumentType
  side: LegSide
  contractCode: str
  optionType: OptionType | None = None
  strikePrice: float | None = None
  expiryDate: str | None = None
  qty: float
  entryPrice: float
  multiplier: float
  createdAt: str
  note: str | None = None


class LegChange(BaseModel):
  legId: str
  quantityChange: float
  price: float
  note: str | None = None

  @field_validator("price")
  @classmethod
  def validate_price(cls, value: float) -> float:
    return _validate_price(value, "成交价")

  @field_validator("quantityChange")
  @classmethod
  def validate_quantity_change(cls, value: float) -> float:
    if value == 0:
      raise ValueError("数量变动不能为 0")
    return value


class PositionEventInput(BaseModel):
  positionId: str
  eventType: PositionEventActionType
  occurredAt: str
  note: str = ""
  legChanges: list[LegChange] = Field(default_factory=list)
  newLegs: list[StrategyLegInput] | None = None

  @field_validator("positionId")
  @classmethod
  def validate_position_id(cls, value: str) -> str:
    return _validate_non_empty_text(value, "持仓 ID")

  @field_validator("occurredAt")
  @classmethod
  def validate_occurred_at(cls, value: str) -> str:
    return _validate_date_like(value, "事件日期")

  @model_validator(mode="after")
  def validate_event_content(self) -> "PositionEventInput":
    if not self.legChanges and not (self.newLegs or []):
      raise ValueError("至少需要一条数量变动或新增一条持仓明细")
    return self


class PositionEventUpdateInput(PositionEventInput):
  pass


class PositionEvent(BaseModel):
  id: str
  positionId: str
  eventType: PositionEventType
  occurredAt: str
  note: str
  legChanges: list[LegChange]
  newLegIds: list[str]
  isInitial: bool | None = None
  audit: AuditStamp = Field(default_factory=AuditStamp)
  createdAt: str


class PriceMark(BaseModel):
  legId: str
  markPrice: float

  @field_validator("markPrice")
  @classmethod
  def validate_mark_price(cls, value: float) -> float:
    return _validate_price(value, "估值价格")


class PriceSnapshotInput(BaseModel):
  positionId: str
  snapshotAt: str
  underlyingPrice: float | None = None
  legMarks: list[PriceMark] = Field(default_factory=list)
  note: str = ""

  @field_validator("positionId")
  @classmethod
  def validate_position_id(cls, value: str) -> str:
    return _validate_non_empty_text(value, "持仓 ID")

  @field_validator("snapshotAt")
  @classmethod
  def validate_snapshot_at(cls, value: str) -> str:
    return _validate_date_like(value, "估值日期")

  @field_validator("underlyingPrice")
  @classmethod
  def validate_underlying_price(cls, value: float | None) -> float | None:
    if value is None:
      return None
    return _validate_price(value, "标的价格")

  @model_validator(mode="after")
  def validate_snapshot_content(self) -> "PriceSnapshotInput":
    if self.underlyingPrice is None and not self.legMarks:
      raise ValueError("至少需要一条估值价格")
    return self


class PriceSnapshotUpdateInput(PriceSnapshotInput):
  pass


class PriceSnapshot(BaseModel):
  id: str
  positionId: str
  snapshotAt: str
  underlyingPrice: float | None = None
  legMarks: list[PriceMark]
  note: str
  audit: AuditStamp = Field(default_factory=AuditStamp)
  createdAt: str


class DailyStat(BaseModel):
  id: str
  date: str
  sourceLabel: str
  principal: float
  equity: float
  returnRatio: float
  cashFlow: float
  profit: float

  @field_validator("date")
  @classmethod
  def validate_date(cls, value: str) -> str:
    return _validate_date_like(value, "统计日期")


class BackupPayload(BaseModel):
  version: int = 2
  exportedAt: str
  positions: list[StrategyPosition] = Field(default_factory=list)
  legs: list[StrategyLeg] = Field(default_factory=list)
  events: list[PositionEvent] = Field(default_factory=list)
  priceSnapshots: list[PriceSnapshot] = Field(default_factory=list)
  stats: list[DailyStat] = Field(default_factory=list)


class ExcelImportPayload(BaseModel):
  positions: list[StrategyPositionInput] = Field(default_factory=list)
  stats: list[DailyStat] = Field(default_factory=list)


class TradeDataBundle(BaseModel):
  positions: list[StrategyPosition] = Field(default_factory=list)
  legs: list[StrategyLeg] = Field(default_factory=list)
  events: list[PositionEvent] = Field(default_factory=list)
  priceSnapshots: list[PriceSnapshot] = Field(default_factory=list)
  stats: list[DailyStat] = Field(default_factory=list)


class ReviewUpdateInput(BaseModel):
  thesis: str = ""
  plan: str = ""
  expectedScenario: str = ""
  riskNotes: str = ""
  exitRule: str = ""
  reviewResult: str = ""
  reviewConclusion: str = ""
  executionAssessment: str = ""
  deviationReason: str = ""
  resultAttribution: str = ""
  nextAction: str = ""
  reviewStatus: ReviewStatus | None = None
  remarks: str = ""
  tags: list[str] = Field(default_factory=list)


class QuotePositionLeg(BaseModel):
  id: str
  contractCode: str
  instrumentType: InstrumentType


class QuotePositionPayload(BaseModel):
  positionId: str
  product: str
  underlyingSymbol: str
  legs: list[QuotePositionLeg] = Field(default_factory=list)


class QuoteRefreshRequest(BaseModel):
  positions: list[QuotePositionPayload] = Field(default_factory=list)


class LiveLegQuote(BaseModel):
  legId: str
  contractCode: str
  instrumentType: InstrumentType
  markPrice: float | None = None
  coverage: QuoteCoverageView
  sourceLabel: str | None = None
  message: str | None = None


class LiveQuoteState(BaseModel):
  positionId: str
  asOf: str
  underlyingPrice: float | None = None
  legQuotes: list[LiveLegQuote] = Field(default_factory=list)
  coverageStatus: LiveQuoteCoverageStatus
  sourceLabel: str
  message: str | None = None


class QuoteServiceHealth(BaseModel):
  status: Literal["ok", "degraded", "offline"]
  sourceLabel: str
  checkedAt: str
  message: str | None = None
