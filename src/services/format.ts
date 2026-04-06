import type { AccountType, PositionEventType, QuoteCoverageView } from '../types/trade'

export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const trimmed = value.replaceAll(',', '').trim()
    if (!trimmed) {
      return undefined
    }

    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatDate(value: string | undefined): string {
  if (!value) {
    return '未记录'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export function formatAccountName(accountType: AccountType): string {
  return accountType === 'live' ? '实盘' : '模拟'
}

export function formatEventType(eventType: PositionEventType): string {
  const labels: Record<PositionEventType, string> = {
    open: '开仓',
    add: '加仓',
    reduce: '减仓',
    close: '平仓',
    roll: '移仓',
  }

  return labels[eventType]
}

export function formatQuoteCoverage(value: QuoteCoverageView): string {
  const labels: Record<QuoteCoverageView, string> = {
    auto: '自动估值',
    manual_required: '需手动估值',
    missing: '暂无行情',
  }

  return labels[value]
}

export function clampText(value: string, fallback = '未填写'): string {
  return value.trim() || fallback
}

export function formatDaysLabel(days?: number): string {
  if (days == null) {
    return '未设置到期日'
  }

  if (days < 0) {
    return `已过期 ${Math.abs(days)} 天`
  }

  return `${days} 天后到期`
}

export function isoNow(): string {
  return new Date().toISOString()
}
