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
  exportTradeBackup,
  fetchTradeBundle,
  importTradeBatch,
  restoreTradeBackup,
  updateTradeReview,
} from '../services/tradeApi'
import type {
  BackupPayload,
  PositionEventInput,
  StrategyPosition,
  StrategyPositionInput,
  TradeDataBundle,
  PriceSnapshotInput,
} from '../types/trade'

interface TradeDataContextValue {
  bundle: TradeDataBundle
  isLoading: boolean
  error?: string
  refreshData: () => Promise<void>
  createPosition: (input: StrategyPositionInput) => Promise<string>
  addEvent: (input: PositionEventInput) => Promise<void>
  saveSnapshot: (input: PriceSnapshotInput) => Promise<void>
  updateReview: (
    positionId: string,
    fields: Pick<
      StrategyPosition,
      'thesis' | 'plan' | 'expectedScenario' | 'reviewResult' | 'reviewConclusion' | 'remarks' | 'tags'
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

  async function saveSnapshot(input: PriceSnapshotInput) {
    await createTradeSnapshot(input)
    await refreshData()
  }

  async function saveReview(
    positionId: string,
    fields: Pick<
      StrategyPosition,
      'thesis' | 'plan' | 'expectedScenario' | 'reviewResult' | 'reviewConclusion' | 'remarks' | 'tags'
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
      saveSnapshot,
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
