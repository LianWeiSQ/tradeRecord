export type AccountType = 'live' | 'paper'
export type PositionStatus = 'open' | 'closed'
export type InstrumentType = 'future' | 'option'
export type LegSide = 'long' | 'short'
export type OptionType = 'C' | 'P'
export type PositionEventType = 'open' | 'add' | 'reduce' | 'close' | 'roll'
export type PositionEventActionType = Exclude<PositionEventType, 'open'>
export type QuoteCoverageView = 'auto' | 'manual_required' | 'missing'
export type LiveQuoteCoverageStatus = 'full' | 'partial' | 'none'
export type ReviewStatus = 'pending' | 'ready' | 'reviewed'
export type RecordSourceType = 'manual' | 'import' | 'auto_close' | 'restore'
export type RecordMutationType = 'created' | 'updated' | 'imported' | 'auto_close' | 'restored'

export interface AuditStamp {
  sourceType: RecordSourceType
  sourceLabel: string
  lastModifiedAt: string
  lastModifiedType: RecordMutationType
}

export interface WorkflowState {
  needsReview: boolean
  needsManualValuation: boolean
  hasDataIssue: boolean
  daysSinceLastUpdate: number
}

export interface Account {
  id: AccountType
  name: string
  description: string
}

export const ACCOUNTS: Account[] = [
  { id: 'live', name: '实盘', description: '真实交易账户' },
  { id: 'paper', name: '模拟', description: '练习与推演账户' },
]

export const POSITION_EVENT_ACTIONS: Array<{
  value: PositionEventActionType
  label: string
}> = [
  { value: 'add', label: '加仓' },
  { value: 'reduce', label: '减仓' },
  { value: 'close', label: '平仓' },
  { value: 'roll', label: '移仓' },
]

export interface StrategyPosition {
  id: string
  accountType: AccountType
  product: string
  underlyingSymbol: string
  strategyName: string
  openedAt: string
  status: PositionStatus
  thesis: string
  plan: string
  expectedScenario: string
  riskNotes: string
  exitRule: string
  reviewResult: string
  reviewConclusion: string
  executionAssessment: string
  deviationReason: string
  resultAttribution: string
  nextAction: string
  reviewStatus: ReviewStatus
  tags: string[]
  remarks: string
  importNotes: string[]
  audit: AuditStamp
  workflowState: WorkflowState
  createdAt: string
  updatedAt: string
  latestSnapshotAt?: string
}

export interface StrategyLeg {
  id: string
  positionId: string
  instrumentType: InstrumentType
  side: LegSide
  contractCode: string
  optionType: OptionType | null
  strikePrice?: number
  expiryDate?: string
  qty: number
  entryPrice: number
  multiplier: number
  createdAt: string
  note?: string
}

export interface LegChange {
  legId: string
  quantityChange: number
  price: number
  note?: string
}

export interface PositionEvent {
  id: string
  positionId: string
  eventType: PositionEventType
  occurredAt: string
  note: string
  legChanges: LegChange[]
  newLegIds: string[]
  isInitial?: boolean
  audit: AuditStamp
  createdAt: string
}

export interface PriceMark {
  legId: string
  markPrice: number
}

export interface PriceSnapshot {
  id: string
  positionId: string
  snapshotAt: string
  underlyingPrice?: number
  legMarks: PriceMark[]
  note: string
  audit: AuditStamp
  createdAt: string
}

export interface DailyStat {
  id: string
  date: string
  sourceLabel: string
  principal: number
  equity: number
  returnRatio: number
  cashFlow: number
  profit: number
}

export interface StrategyLegInput {
  id?: string
  instrumentType: InstrumentType
  side: LegSide
  contractCode: string
  optionType: OptionType | null
  strikePrice?: number
  expiryDate?: string
  qty: number
  entryPrice: number
  multiplier: number
  note?: string
  createdAt?: string
}

export interface StrategyPositionInput {
  accountType: AccountType
  product: string
  underlyingSymbol: string
  strategyName: string
  openedAt: string
  thesis: string
  plan: string
  expectedScenario: string
  riskNotes: string
  exitRule: string
  reviewResult: string
  reviewConclusion: string
  executionAssessment: string
  deviationReason: string
  resultAttribution: string
  nextAction: string
  reviewStatus: ReviewStatus
  tags: string[]
  remarks: string
  importNotes?: string[]
  legs: StrategyLegInput[]
}

export interface PositionEventInput {
  positionId: string
  eventType: PositionEventActionType
  occurredAt: string
  note: string
  legChanges: LegChange[]
  newLegs?: StrategyLegInput[]
}

export interface PositionEventUpdateInput extends PositionEventInput {}

export interface PriceSnapshotInput {
  positionId: string
  snapshotAt: string
  underlyingPrice?: number
  legMarks: PriceMark[]
  note: string
}

export interface PriceSnapshotUpdateInput extends PriceSnapshotInput {}

export interface LiveLegQuote {
  legId: string
  contractCode: string
  instrumentType: InstrumentType
  markPrice?: number
  coverage: QuoteCoverageView
  sourceLabel?: string
  message?: string
}

export interface LiveQuoteState {
  positionId: string
  asOf: string
  underlyingPrice?: number
  legQuotes: LiveLegQuote[]
  coverageStatus: LiveQuoteCoverageStatus
  sourceLabel: string
  message?: string
}

export interface QuoteServiceHealth {
  status: 'ok' | 'degraded' | 'offline'
  sourceLabel: string
  checkedAt: string
  message?: string
}

export interface QuotePositionSyncPayload {
  positionId: string
  product: string
  underlyingSymbol: string
  legs: Array<{
    id: string
    contractCode: string
    instrumentType: InstrumentType
  }>
}

export interface QuoteRefreshRequest {
  positions: QuotePositionSyncPayload[]
}

export interface PendingCloseSnapshotPayload {
  signature: string
  snapshot: PriceSnapshotInput
}

export interface ExcelImportResult {
  positions: StrategyPositionInput[]
  stats: DailyStat[]
  importWarnings: string[]
  importNotes: string[]
}

export interface BackupPayload {
  version: 1
  exportedAt: string
  positions: StrategyPosition[]
  legs: StrategyLeg[]
  events: PositionEvent[]
  priceSnapshots: PriceSnapshot[]
  stats: DailyStat[]
}

export interface TradeDataBundle {
  positions: StrategyPosition[]
  legs: StrategyLeg[]
  events: PositionEvent[]
  priceSnapshots: PriceSnapshot[]
  stats: DailyStat[]
}

export interface LegMetrics {
  legId: string
  currentQty: number
  avgCost: number
  markPrice?: number
  realizedPnl: number
  unrealizedPnl: number
  currentValue: number
}

export interface PositionMetrics {
  totalQty: number
  realizedPnl: number
  unrealizedPnl: number
  latestMarkAt?: string
  legMetrics: LegMetrics[]
}

export interface DashboardPositionView {
  position: StrategyPosition
  legs: StrategyLeg[]
  events: PositionEvent[]
  latestSnapshot?: PriceSnapshot
  metrics: PositionMetrics
  nearestExpiryDays?: number
}

export interface DashboardGroupView {
  accountType: AccountType
  product: string
  positions: DashboardPositionView[]
  openCount: number
  totalUnrealizedPnl: number
  totalRealizedPnl: number
  nearestExpiryDays?: number
  latestSnapshotAt?: string
}

export interface DashboardFilterState {
  accountType: AccountType | 'all'
  product: string | 'all'
  status: PositionStatus | 'all'
  range: 'all' | '30d' | '90d'
  search: string
}

export interface DashboardOverviewView {
  openCount: number
  totalUnrealizedPnl: number
  totalRealizedPnl: number
  totalGroups: number
  latestSnapshotAt?: string
}

export interface RecentActivityView {
  id: string
  type: 'open' | 'event' | 'valuation'
  title: string
  subtitle: string
  occurredAt: string
  amountLabel?: string
}

export interface ReviewFilterState {
  accountType: AccountType | 'all'
  product: string | 'all'
  reviewStatus: ReviewStatus | 'all'
  range: 'all' | '30d' | '90d'
  search: string
}

export interface ReviewStatsView {
  totalClosed: number
  reviewedCount: number
  pendingCount: number
  winRate: number
  averageHoldingDays: number
  bestPnl: number
  worstPnl: number
}

export interface WorkItemView {
  id: string
  positionId: string
  kind: 'review' | 'valuation' | 'expiry' | 'stale' | 'data_issue'
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
  dueLabel?: string
}

export interface NavigationItem {
  to: string
  label: string
  shortLabel: string
  icon: string
}

export interface AppShellState {
  sidebarCollapsed: boolean
}
