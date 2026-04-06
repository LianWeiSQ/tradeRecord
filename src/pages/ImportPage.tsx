import { useRef, useState } from 'react'
import { useTradeData } from '../components/TradeDataProvider'
import { importWorkbook } from '../services/excelImport'
import type { ExcelImportResult } from '../types/trade'

export function ImportPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { saveImportBatch } = useTradeData()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ExcelImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function handleParse() {
    if (!file) {
      setMessage('请先选择 Excel 文件。')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      const parsed = await importWorkbook(file)
      setResult(parsed)
      setMessage(`解析完成，共 ${parsed.positions.length} 笔记录，${parsed.stats.length} 条统计数据。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解析失败，请检查文件格式。')
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!result) {
      return
    }

    setBusy(true)
    setMessage('')

    try {
      await saveImportBatch(result.positions, result.stats)
      setMessage('解析结果已保存到 Python 后端。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败，请稍后再试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="page-intro">
        <div>
          <h2>Excel 导入向导</h2>
          <p>只支持当前这套固定模板，流程是选择文件、解析预览、确认后再保存。</p>
        </div>
      </section>

      <section className="wizard-grid">
        <article className="card">
          <div className="section-head">
            <div>
              <h3>1. 选择文件</h3>
              <p>支持 `.xlsx`。建议直接使用你当前固定格式的模板，不做自定义映射。</p>
            </div>
          </div>

          <div className="data-actions">
            <button className="btn btn--secondary" type="button" onClick={() => fileInputRef.current?.click()}>
              选择 Excel
            </button>
            <button className="btn" disabled={!file || busy} type="button" onClick={() => void handleParse()}>
              {busy ? '解析中...' : '开始解析'}
            </button>
          </div>

          <input
            ref={fileInputRef}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            type="file"
            onChange={(event) => {
              const nextFile = event.target.files?.[0] ?? null
              setFile(nextFile)
              setResult(null)
              setMessage(nextFile ? `已选择 ${nextFile.name}` : '')
            }}
          />

          {file ? (
            <div className="kv-block">
              <span>当前文件</span>
              <strong>{file.name}</strong>
            </div>
          ) : null}
        </article>

        <article className="card">
          <div className="section-head">
            <div>
              <h3>2. 解析结果</h3>
              <p>解析后先看数量和警告，再决定是否保存到后端。</p>
            </div>
          </div>

          {result ? (
            <div className="metric-grid metric-grid--three">
              <div className="metric-card metric-card--accent">
                <span>交易记录</span>
                <strong>{result.positions.length}</strong>
              </div>
              <div className="metric-card">
                <span>统计数据</span>
                <strong>{result.stats.length}</strong>
              </div>
              <div className="metric-card metric-card--soft">
                <span>警告</span>
                <strong>{result.importWarnings.length}</strong>
              </div>
            </div>
          ) : (
            <div className="empty-inline">还没有解析结果。</div>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <div>
              <h3>3. 保存到后端</h3>
              <p>确认解析结果无误后再保存，保存后首页和详情页就能直接使用这些记录。</p>
            </div>
          </div>

          <div className="data-actions">
            <button className="btn" disabled={!result || busy} type="button" onClick={() => void handleSave()}>
              保存到后端
            </button>
          </div>
        </article>
      </section>

      {message ? <div className="notice-banner">{message}</div> : null}

      {result ? (
        <section className="dashboard-grid">
          <div className="dashboard-grid__main">
            <section className="card">
              <div className="section-head">
                <div>
                  <h3>仓单预览</h3>
                  <p>这里列出即将进入系统的交易记录，保存前可以先核对一遍。</p>
                </div>
              </div>

              {result.positions.length ? (
                <div className="preview-list">
                  {result.positions.slice(0, 20).map((position) => (
                    <article className="preview-item" key={`${position.accountType}-${position.strategyName}`}>
                      <div className="preview-item__top">
                        <div>
                          <strong>{position.strategyName}</strong>
                          <p>
                            {position.accountType === 'live' ? '实盘' : '模拟'} · {position.product} · {position.underlyingSymbol}
                          </p>
                        </div>
                        <span className="pill">{position.legs.length} 条持仓明细</span>
                      </div>
                      <div className="tag-row">
                        {position.legs.slice(0, 6).map((leg, index) => (
                          <span className="tag" key={`${position.strategyName}-${leg.contractCode}-${index}`}>
                            {leg.side === 'long' ? '多' : '空'} {leg.contractCode}
                            {leg.optionType ? ` ${leg.optionType}${leg.strikePrice ?? ''}` : ''} x{leg.qty}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-inline">解析完成，但没有识别到可导入的仓单。</div>
              )}
            </section>
          </div>

          <div className="dashboard-grid__side">
            <section className="card">
              <div className="section-head">
                <div>
                  <h3>导入提醒</h3>
                  <p>无法可靠结构化的内容不会静默丢失，会在这里提示。</p>
                </div>
              </div>

              {result.importWarnings.length ? (
                <ul className="warning-list">
                  {result.importWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : (
                <div className="empty-inline">没有结构化导入警告。</div>
              )}

              {result.importNotes.length ? (
                <div className="summary-list">
                  {result.importNotes.slice(0, 10).map((note) => (
                    <div className="kv-block" key={note}>
                      <span>导入附注</span>
                      <strong>{note}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </section>
      ) : null}
    </>
  )
}
