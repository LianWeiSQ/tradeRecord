from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


AccountType = Literal["live", "paper"]
PositionStatus = Literal["open", "closed"]
InstrumentType = Literal["future", "option"]
LegSide = Literal["long", "short"]
OptionType = Literal["C", "P"]
PositionEventType = Literal["open", "add", "reduce", "close", "roll"]
PositionEventActionType = Literal["add", "reduce", "close", "roll"]
QuoteCoverageView = Literal["auto", "manual_required", "missing"]
LiveQuoteCoverageStatus = Literal["full", "partial", "none"]


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


class StrategyPositionInput(BaseModel):
    accountType: AccountType
    product: str
    underlyingSymbol: str
    strategyName: str
    openedAt: str
    thesis: str = ""
    plan: str = ""
    expectedScenario: str = ""
    reviewResult: str = ""
    reviewConclusion: str = ""
    tags: list[str] = Field(default_factory=list)
    remarks: str = ""
    importNotes: list[str] | None = None
    legs: list[StrategyLegInput]


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
    reviewResult: str
    reviewConclusion: str
    tags: list[str]
    remarks: str
    importNotes: list[str]
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


class PositionEventInput(BaseModel):
    positionId: str
    eventType: PositionEventActionType
    occurredAt: str
    note: str = ""
    legChanges: list[LegChange] = Field(default_factory=list)
    newLegs: list[StrategyLegInput] | None = None


class PositionEvent(BaseModel):
    id: str
    positionId: str
    eventType: PositionEventType
    occurredAt: str
    note: str
    legChanges: list[LegChange]
    newLegIds: list[str]
    isInitial: bool | None = None
    createdAt: str


class PriceMark(BaseModel):
    legId: str
    markPrice: float


class PriceSnapshotInput(BaseModel):
    positionId: str
    snapshotAt: str
    underlyingPrice: float | None = None
    legMarks: list[PriceMark] = Field(default_factory=list)
    note: str = ""


class PriceSnapshot(BaseModel):
    id: str
    positionId: str
    snapshotAt: str
    underlyingPrice: float | None = None
    legMarks: list[PriceMark]
    note: str
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


class BackupPayload(BaseModel):
    version: int = 1
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
    reviewResult: str = ""
    reviewConclusion: str = ""
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
