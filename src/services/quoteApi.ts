import type { LiveQuoteState, QuoteRefreshRequest, QuoteServiceHealth } from '../types/trade'

const QUOTE_API_BASE_URL =
  import.meta.env.VITE_BACKEND_BASE_URL?.replace(/\/$/, '') ??
  import.meta.env.VITE_QUOTE_API_BASE_URL?.replace(/\/$/, '') ??
  'http://127.0.0.1:8765'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${QUOTE_API_BASE_URL}${path}`, {
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

export interface OpenPositionsQuoteResponse {
  quotes: LiveQuoteState[]
  asOf?: string
}

export function getQuoteApiBaseUrl() {
  return QUOTE_API_BASE_URL
}

export async function fetchQuoteHealth(): Promise<QuoteServiceHealth> {
  return request<QuoteServiceHealth>('/health', { method: 'GET' })
}

export async function fetchCachedOpenPositionQuotes(): Promise<OpenPositionsQuoteResponse> {
  return request<OpenPositionsQuoteResponse>('/quotes/open-positions', { method: 'GET' })
}

export async function refreshOpenPositionQuotes(
  payload: QuoteRefreshRequest,
): Promise<OpenPositionsQuoteResponse> {
  return request<OpenPositionsQuoteResponse>('/quotes/refresh', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function triggerCloseSnapshots(
  payload: QuoteRefreshRequest,
): Promise<{ snapshots: Array<{ signature: string; positionId: string }> }> {
  return request<{ snapshots: Array<{ signature: string; positionId: string }> }>('/quotes/snapshot/close', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
