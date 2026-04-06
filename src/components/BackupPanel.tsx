import { useRef, useState, type ChangeEvent } from 'react'
import { useTradeData } from './TradeDataProvider'
import type { BackupPayload } from '../types/trade'

export function BackupPanel() {
  const restoreInputRef = useRef<HTMLInputElement | null>(null)
  const { clearAllData, exportBackup, restoreBackup } = useTradeData()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function handleExport() {
    setBusy(true)
    setMessage('')

    try {
      const payload = await exportBackup()
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `trade-record-backup-${payload.exportedAt.slice(0, 10)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setMessage('当前后端数据已导出为 JSON。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导出失败，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const text = await file.text()
      const payload = JSON.parse(text) as BackupPayload
      await restoreBackup(payload)
      setMessage('后端数据已从 JSON 恢复。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败，请检查备份文件。')
    } finally {
      setBusy(false)
      event.target.value = ''
    }
  }

  async function handleClearAll() {
    const confirmed = window.confirm(
      '这会清空 Python 后端里保存的全部开仓、仓位事件、估值和导入数据。建议先导出 JSON 备份。确定继续吗？',
    )

    if (!confirmed) {
      return
    }

    const secondConfirmed = window.confirm(
      '请再次确认：清空后首页会恢复为空，且无法撤销。是否继续？',
    )

    if (!secondConfirmed) {
      return
    }

    setBusy(true)
    setMessage('')

    try {
      await clearAllData()
      setMessage('全部后端数据已清空，现在可以重新录入或重新导入 Excel。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '清空失败，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card card--soft">
      <div className="section-head">
        <div>
          <h3>数据管理</h3>
          <p>导出、恢复和清空都集中放在这里，方便你重新整理后端数据。</p>
        </div>
      </div>

      <div className="data-actions">
        <button className="btn" disabled={busy} type="button" onClick={handleExport}>
          导出 JSON
        </button>
        <button
          className="btn btn--secondary"
          disabled={busy}
          type="button"
          onClick={() => restoreInputRef.current?.click()}
        >
          恢复 JSON
        </button>
        <button
          className="btn btn--ghost"
          disabled={busy}
          type="button"
          onClick={handleClearAll}
        >
          清空全部数据
        </button>
      </div>

      <input
        ref={restoreInputRef}
        accept=".json,application/json"
        hidden
        type="file"
        onChange={handleRestore}
      />

      <p className="subtle">清空全部数据会删除 Python 后端内的所有本地记录，适合准备重录时使用。</p>

      {message ? <div className="notice-banner">{message}</div> : null}
    </div>
  )
}
