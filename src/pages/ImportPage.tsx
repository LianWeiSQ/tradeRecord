import { useMemo, useRef, useState } from 'react'
import { useTradeData } from '../components/TradeDataProvider'
import { importWorkbook } from '../services/excelImport'
import type { ExcelImportResult, StrategyPositionInput } from '../types/trade'

function positionKey(position: Pick<StrategyPositionInput, 'accountType' | 'product' | 'underlyingSymbol' | 'strategyName' | 'openedAt'>) {
  return [
    position.accountType,
    position.product.trim().toLowerCase(),
    position.underlyingSymbol.trim().toLowerCase(),
    position.strategyName.trim().toLowerCase(),
    position.openedAt,
  ].join('::')
}

export function ImportPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const { bundle, saveImportBatch } = useTradeData()
  const [file, setFile] = useState<File | null>(null)
  const [result, setResult] = useState<ExcelImportResult | null>(null)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const existingKeys = useMemo(
    () => new Set(bundle.positions.map((position) => positionKey(position))),
    [bundle.positions],
  )

  const previewItems = useMemo(() => {
    if (!result) {
      return []
    }

    const counts = new Map<string, number>()
    return result.positions.map((position, index) => {
      const key = positionKey(position)
      const nextCount = (counts.get(key) ?? 0) + 1
      counts.set(key, nextCount)

      return {
        id: `${key}-${index}`,
        position,
        key,
        duplicateInSystem: existingKeys.has(key),
        duplicateInFile: nextCount > 1,
      }
    })
  }, [existingKeys, result])

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
      setSelectedKeys(parsed.positions.map((position, index) => `${positionKey(position)}-${index}`))
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

    const selected = previewItems
      .filter((item) => selectedKeys.includes(item.id))
      .map((item) => item.position)

    if (!selected.length) {
      setMessage('请至少勾选一条记录再保存。')
      return
    }

    setBusy(true)
    setMessage('')

    try {
      await saveImportBatch(selected, result.stats)
      setMessage(`已保存 ${selected.length} 笔记录到后端。`)
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
          <p>流程固定为“选择文件 → 解析预览 → 排查异常/勾选 → 保存”。</p>
        </div>
      </section>

      <section className="wizard-grid">
        <article className="card">
          <div className="section-head">
            <div>
              <h3>1. 选择文件</h3>
              <p>支持 `.xlsx`，建议直接使用当前固定模板。</p>
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
              setSelectedKeys([])
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
              <p>先看数量、警告和重复风险，再决定是否保存。</p>
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
                <span>警告 / 风险</span>
                <strong>
                  {result.importWarnings.length} /{' '}
                  {previewItems.filter((item) => item.duplicateInSystem || item.duplicateInFile).length}
                </strong>
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
              <p>保存前可以剔除疑似重复或不想导入的记录。</p>
            </div>
          </div>

          <div className="data-actions">
            <button className="btn" disabled={!result || busy} type="button" onClick={() => void handleSave()}>
              保存选中记录
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
                  <p>可以逐条勾选；系统内重复和文件内重复会高亮提示。</p>
                </div>
              </div>

              {previewItems.length ? (
                <div className="preview-list">
                  {previewItems.map((item) => (
                    <article className="preview-item" key={item.id}>
                      <div className="preview-item__top">
                        <label className="tag-row">
                          <input
                            checked={selectedKeys.includes(item.id)}
                            type="checkbox"
                            onChange={(event) =>
                              setSelectedKeys((current) =>
                                event.target.checked
                                  ? [...current, item.id]
                                  : current.filter((value) => value !== item.id),
                              )
                            }
                          />
                          <strong>{item.position.strategyName}</strong>
                        </label>
                        <div className="tag-row">
                          {item.duplicateInSystem ? <span className="pill">系统内疑似重复</span> : null}
                          {item.duplicateInFile ? <span className="pill">文件内重复</span> : null}
                          <span className="pill">{item.position.legs.length} 条腿</span>
                        </div>
                      </div>

                      <p>
                        {item.position.accountType === 'live' ? '实盘' : '模拟'} / {item.position.product} /{' '}
                        {item.position.underlyingSymbol} / {item.position.openedAt}
                      </p>

                      <div className="tag-row">
                        {item.position.legs.slice(0, 6).map((leg, index) => (
                          <span className="tag" key={`${item.id}-${leg.contractCode}-${index}`}>
                            {leg.side === 'long' ? '多' : '空'} {leg.contractCode} x{leg.qty}
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
                  <p>结构化失败和辅助说明不会静默丢失，都会显示在这里。</p>
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
