import type {
  BackupPayload,
  PositionEventInput,
  PositionEventUpdateInput,
  PriceSnapshotInput,
  PriceSnapshotUpdateInput,
  StrategyPosition,
  StrategyPositionInput,
  TradeDataBundle,
} from '../types/trade'

const BACKEND_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL?.replace(/\/$/, '') ??
  import.meta.env.VITE_QUOTE_API_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8765'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const detail = await response.text()
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } }
      throw new Error(parsed.error?.message || `请求失败: ${response.status}`)
    } catch {
      throw new Error(detail || `请求失败: ${response.status}`)
    }
  }

  return (await response.json()) as T
}

export function getBackendBaseUrl() {
  return BACKEND_BASE_URL
}

export async function fetchTradeBundle(): Promise<TradeDataBundle> {
  return request<TradeDataBundle>('/api/trades/bundle', { method: 'GET' })
}

export async function createTradePosition(input: StrategyPositionInput): Promise<string> {
  const result = await request<{ positionId: string }>('/api/trades/positions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return result.positionId
}

export async function createTradeEvent(input: PositionEventInput): Promise<void> {
  await request<{ ok: boolean }>('/api/trades/events', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateTradeEvent(eventId: string, input: PositionEventUpdateInput): Promise<void> {
  await request<{ ok: boolean }>(`/api/trades/events/${eventId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function deleteTradeEvent(eventId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/trades/events/${eventId}`, {
    method: 'DELETE',
  })
}

export async function createTradeSnapshot(input: PriceSnapshotInput): Promise<void> {
  await request<{ ok: boolean }>('/api/trades/snapshots', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateTradeSnapshot(
  snapshotId: string,
  input: PriceSnapshotUpdateInput,
): Promise<void> {
  await request<{ ok: boolean }>(`/api/trades/snapshots/${snapshotId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export async function deleteTradeSnapshot(snapshotId: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/trades/snapshots/${snapshotId}`, {
    method: 'DELETE',
  })
}

export async function updateTradeReview(
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
): Promise<void> {
  await request<{ ok: boolean }>(`/api/trades/reviews/${positionId}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  })
}

export async function importTradeBatch(payload: Pick<TradeDataBundle, 'stats'> & { positions: StrategyPositionInput[] }): Promise<void> {
  await request<{ ok: boolean }>('/api/trades/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function exportTradeBackup(): Promise<BackupPayload> {
  return request<BackupPayload>('/api/trades/backup', { method: 'GET' })
}

export async function restoreTradeBackup(payload: BackupPayload): Promise<void> {
  await request<{ ok: boolean }>('/api/trades/restore', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function clearTradeData(): Promise<void> {
  await request<{ ok: boolean }>('/api/trades/all', { method: 'DELETE' })
}
