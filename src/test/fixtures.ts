import type {
  AuditStamp,
  PositionEvent,
  PriceSnapshot,
  StrategyPosition,
  WorkflowState,
} from '../types/trade'

export function makeAudit(overrides: Partial<AuditStamp> = {}): AuditStamp {
  return {
    sourceType: 'manual',
    sourceLabel: 'manual',
    lastModifiedAt: '2026-04-01T00:00:00.000Z',
    lastModifiedType: 'created',
    ...overrides,
  }
}

export function makeWorkflow(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    needsReview: false,
    needsManualValuation: false,
    hasDataIssue: false,
    daysSinceLastUpdate: 0,
    ...overrides,
  }
}

export function makePosition(overrides: Partial<StrategyPosition> = {}): StrategyPosition {
  return {
    id: 'position-1',
    accountType: 'live',
    product: '股指',
    underlyingSymbol: 'IH2509',
    strategyName: '测试交易',
    openedAt: '2026-04-01',
    status: 'open',
    thesis: '',
    plan: '',
    expectedScenario: '',
    riskNotes: '',
    exitRule: '',
    reviewResult: '',
    reviewConclusion: '',
    executionAssessment: '',
    deviationReason: '',
    resultAttribution: '',
    nextAction: '',
    reviewStatus: 'pending',
    tags: [],
    remarks: '',
    importNotes: [],
    audit: makeAudit(),
    workflowState: makeWorkflow(),
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    latestSnapshotAt: undefined,
    ...overrides,
  }
}

export function makeEvent(overrides: Partial<PositionEvent> = {}): PositionEvent {
  return {
    id: 'event-1',
    positionId: 'position-1',
    eventType: 'open',
    occurredAt: '2026-04-01',
    note: '',
    legChanges: [],
    newLegIds: [],
    isInitial: true,
    audit: makeAudit(),
    createdAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

export function makeSnapshot(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    id: 'snapshot-1',
    positionId: 'position-1',
    snapshotAt: '2026-04-05',
    underlyingPrice: 2800,
    legMarks: [],
    note: '',
    audit: makeAudit(),
    createdAt: '2026-04-05T00:00:00.000Z',
    ...overrides,
  }
}
