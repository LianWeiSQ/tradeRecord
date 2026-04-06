import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'
import { useTradeData } from './TradeDataProvider'
import {
  fetchCachedOpenPositionQuotes,
  fetchQuoteHealth,
  getQuoteApiBaseUrl,
  refreshOpenPositionQuotes,
  triggerCloseSnapshots,
} from '../services/quoteApi'
import type {
  InstrumentType,
  LiveQuoteState,
  QuotePositionSyncPayload,
  QuoteRefreshRequest,
  QuoteServiceHealth,
} from '../types/trade'

interface LiveQuotesContextValue {
  liveQuotes: Map<string, LiveQuoteState>
  health: QuoteServiceHealth
  isRefreshing: boolean
  isRunningCloseSnapshot: boolean
  lastSynchronizedAt?: string
  refreshQuotes: () => Promise<void>
  runCloseSnapshot: () => Promise<void>
  quoteApiBaseUrl: string
}

const defaultHealth: QuoteServiceHealth = {
  status: 'offline',
  sourceLabel: 'AkShare',
  checkedAt: new Date().toISOString(),
  message: '行情服务未连接',
}

const LiveQuotesContext = createContext<LiveQuotesContextValue | null>(null)

function buildSyncPayload(positions: QuotePositionSyncPayload[]): QuoteRefreshRequest {
  return { positions }
}

export function LiveQuotesProvider({ children }: PropsWithChildren) {
  const { bundle, refreshData } = useTradeData()
  const [quotes, setQuotes] = useState<Map<string, LiveQuoteState>>(new Map())
  const [health, setHealth] = useState<QuoteServiceHealth>(defaultHealth)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRunningCloseSnapshot, setIsRunningCloseSnapshot] = useState(false)
  const [lastSynchronizedAt, setLastSynchronizedAt] = useState<string>()

  const refreshPayload = useMemo(() => {
    const legsByPosition = new Map<string, QuotePositionSyncPayload['legs']>()

    for (const leg of bundle.legs) {
      const bucket = legsByPosition.get(leg.positionId) ?? []
      bucket.push({
        id: leg.id,
        contractCode: leg.contractCode,
        instrumentType: leg.instrumentType as InstrumentType,
      })
      legsByPosition.set(leg.positionId, bucket)
    }

    return buildSyncPayload(
      bundle.positions
        .filter((position) => position.status === 'open')
        .map((position) => ({
          positionId: position.id,
          product: position.product,
          underlyingSymbol: position.underlyingSymbol,
          legs: legsByPosition.get(position.id) ?? [],
        })),
    )
  }, [bundle.legs, bundle.positions])

  const refreshSignature = useMemo(() => JSON.stringify(refreshPayload), [refreshPayload])

  async function refreshQuotes() {
    if (!refreshPayload.positions.length) {
      setQuotes(new Map())
      setLastSynchronizedAt(undefined)
      return
    }

    setIsRefreshing(true)
    try {
      const [healthResponse, quoteResponse] = await Promise.all([
        fetchQuoteHealth(),
        refreshOpenPositionQuotes(refreshPayload),
      ])

      setHealth(healthResponse)
      setQuotes(new Map(quoteResponse.quotes.map((item) => [item.positionId, item])))
      setLastSynchronizedAt(quoteResponse.asOf ?? new Date().toISOString())
    } catch (error) {
      setHealth({
        status: 'offline',
        sourceLabel: 'AkShare',
        checkedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : '行情刷新失败',
      })
    } finally {
      setIsRefreshing(false)
    }
  }

  async function runCloseSnapshot() {
    if (!refreshPayload.positions.length) {
      return
    }

    setIsRunningCloseSnapshot(true)
    try {
      await triggerCloseSnapshots(refreshPayload)
      await refreshData()
      await refreshQuotes()
    } finally {
      setIsRunningCloseSnapshot(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const [healthResponse, cachedQuotes] = await Promise.all([
          fetchQuoteHealth(),
          fetchCachedOpenPositionQuotes(),
        ])
        setHealth(healthResponse)
        setQuotes(new Map(cachedQuotes.quotes.map((item) => [item.positionId, item])))
        setLastSynchronizedAt(cachedQuotes.asOf)
      } catch {
        setHealth(defaultHealth)
      }
    })()
  }, [])

  useEffect(() => {
    if (!refreshPayload.positions.length) {
      setQuotes(new Map())
      setLastSynchronizedAt(undefined)
      return
    }

    void refreshQuotes()
  }, [refreshSignature])

  useEffect(() => {
    if (!refreshPayload.positions.length) {
      return
    }

    const timer = window.setInterval(() => {
      void refreshQuotes()
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [refreshSignature])

  const value = useMemo<LiveQuotesContextValue>(
    () => ({
      liveQuotes: quotes,
      health,
      isRefreshing,
      isRunningCloseSnapshot,
      lastSynchronizedAt,
      refreshQuotes,
      runCloseSnapshot,
      quoteApiBaseUrl: getQuoteApiBaseUrl(),
    }),
    [health, isRefreshing, isRunningCloseSnapshot, lastSynchronizedAt, quotes],
  )

  return <LiveQuotesContext.Provider value={value}>{children}</LiveQuotesContext.Provider>
}

export function useLiveQuotes() {
  const context = useContext(LiveQuotesContext)
  if (!context) {
    throw new Error('useLiveQuotes must be used within LiveQuotesProvider')
  }

  return context
}
