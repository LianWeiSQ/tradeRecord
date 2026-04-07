import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import {
  clearTradeData,
  createTradeEvent,
  createTradePosition,
  createTradeSnapshot,
  deleteTradeEvent,
  deleteTradeSnapshot,
  exportTradeBackup,
  fetchTradeBundle,
  importTradeBatch,
  restoreTradeBackup,
  updateTradeEvent,
  updateTradeReview,
  updateTradeSnapshot,
} from '../services/tradeApi'
import type {
  BackupPayload,
  PositionEventInput,
  PositionEventUpdateInput,
  StrategyPosition,
  StrategyPositionInput,
  TradeDataBundle,
  PriceSnapshotInput,
  PriceSnapshotUpdateInput,
} from '../types/trade'

interface TradeDataContextValue {
  bundle: TradeDataBundle
  isLoading: boolean
  error?: string
  refreshData: () => Promise<void>
  createPosition: (input: StrategyPositionInput) => Promise<string>
  addEvent: (input: PositionEventInput) => Promise<void>
  editEvent: (eventId: string, input: PositionEventUpdateInput) => Promise<void>
  removeEvent: (eventId: string) => Promise<void>
  saveSnapshot: (input: PriceSnapshotInput) => Promise<void>
  editSnapshot: (snapshotId: string, input: PriceSnapshotUpdateInput) => Promise<void>
  removeSnapshot: (snapshotId: string) => Promise<void>
  updateReview: (
    positionId: string,
    fields: Pick<
      StrategyPosition,
      | 'thesis'
      | 'plan'
      | 'expectedScenario'
      | 'riskNotes'
      | 'exitRule'
      | 'reviewResult'
      | 'reviewConclusion'
      | 'executionAssessment'
      | 'deviationReason'
      | 'resultAttribution'
      | 'nextAction'
      | 'reviewStatus'
      | 'remarks'
      | 'tags'
    >,
  ) => Promise<void>
  saveImportBatch: (inputs: StrategyPositionInput[], stats: TradeDataBundle['stats']) => Promise<void>
  exportBackup: () => Promise<BackupPayload>
  restoreBackup: (payload: BackupPayload) => Promise<void>
  clearAllData: () => Promise<void>
}

const emptyBundle: TradeDataBundle = {
  positions: [],
  legs: [],
  events: [],
  priceSnapshots: [],
  stats: [],
}

const TradeDataContext = createContext<TradeDataContextValue | null>(null)

export function TradeDataProvider({ children }: PropsWithChildren) {
  const [bundle, setBundle] = useState<TradeDataBundle>(emptyBundle)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()

  async function refreshData() {
    setError(undefined)
    try {
      const nextBundle = await fetchTradeBundle()
      setBundle(nextBundle)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取后端数据失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void refreshData()
  }, [])

  async function createPosition(input: StrategyPositionInput) {
    const positionId = await createTradePosition(input)
    await refreshData()
    return positionId
  }

  async function addEvent(input: PositionEventInput) {
    await createTradeEvent(input)
    await refreshData()
  }

  async function editEvent(eventId: string, input: PositionEventUpdateInput) {
    await updateTradeEvent(eventId, input)
    await refreshData()
  }

  async function removeEvent(eventId: string) {
    await deleteTradeEvent(eventId)
    await refreshData()
  }

  async function saveSnapshot(input: PriceSnapshotInput) {
    await createTradeSnapshot(input)
    await refreshData()
  }

  async function editSnapshot(snapshotId: string, input: PriceSnapshotUpdateInput) {
    await updateTradeSnapshot(snapshotId, input)
    await refreshData()
  }

  async function removeSnapshot(snapshotId: string) {
    await deleteTradeSnapshot(snapshotId)
    await refreshData()
  }

  async function saveReview(
    positionId: string,
    fields: Pick<
      StrategyPosition,
      | 'thesis'
      | 'plan'
      | 'expectedScenario'
      | 'riskNotes'
      | 'exitRule'
      | 'reviewResult'
      | 'reviewConclusion'
      | 'executionAssessment'
      | 'deviationReason'
      | 'resultAttribution'
      | 'nextAction'
      | 'reviewStatus'
      | 'remarks'
      | 'tags'
    >,
  ) {
    await updateTradeReview(positionId, fields)
    await refreshData()
  }

  async function saveImport(inputs: StrategyPositionInput[], stats: TradeDataBundle['stats']) {
    await importTradeBatch({ positions: inputs, stats })
    await refreshData()
  }

  async function restoreBackup(payload: BackupPayload) {
    await restoreTradeBackup(payload)
    await refreshData()
  }

  async function clearAllData() {
    await clearTradeData()
    await refreshData()
  }

  const value = useMemo<TradeDataContextValue>(
    () => ({
      bundle,
      isLoading,
      error,
      refreshData,
      createPosition,
      addEvent,
      editEvent,
      removeEvent,
      saveSnapshot,
      editSnapshot,
      removeSnapshot,
      updateReview: saveReview,
      saveImportBatch: saveImport,
      exportBackup: exportTradeBackup,
      restoreBackup,
      clearAllData,
    }),
    [bundle, error, isLoading],
  )

  return <TradeDataContext.Provider value={value}>{children}</TradeDataContext.Provider>
}

export function useTradeData() {
  const context = useContext(TradeDataContext)
  if (!context) {
    throw new Error('useTradeData must be used within TradeDataProvider')
  }

  return context
}
