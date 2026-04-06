import { formatDateTime, formatEventType, formatMoney } from '../services/format'
import type { PositionEvent, StrategyLeg } from '../types/trade'

interface EventTimelineProps {
  events: PositionEvent[]
  legs: StrategyLeg[]
}

export function EventTimeline({ events, legs }: EventTimelineProps) {
  const ordered = [...events].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  )
  const legsById = new Map(legs.map((leg) => [leg.id, leg]))

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h3>仓位事件</h3>
          <p>这笔交易只在首次建立时开仓，后续所有变化都按事件时间线追加在这里。</p>
        </div>
      </div>

      {ordered.length ? (
        <div className="timeline">
          {ordered.map((event) => (
            <article className="timeline-item" key={event.id}>
              <div className="timeline-item__top">
                <div>
                  <strong>{formatEventType(event.eventType)}</strong>
                  <p>{formatDateTime(event.occurredAt)}</p>
                </div>
                {event.isInitial ? <span className="pill">首次开仓</span> : null}
              </div>

              {event.note ? <p>{event.note}</p> : null}

              <div className="list-stack">
                {event.legChanges.map((change) => {
                  const leg = legsById.get(change.legId)

                  return (
                    <div className="kv" key={`${event.id}-${change.legId}`}>
                      <span>{leg?.contractCode ?? change.legId}</span>
                      <strong>
                        数量变化 {change.quantityChange > 0 ? '+' : ''}
                        {change.quantityChange} · 成交价 {formatMoney(change.price)}
                      </strong>
                    </div>
                  )
                })}

                {event.newLegIds.length ? (
                  <div className="kv">
                    <span>新增持仓明细</span>
                    <strong>
                      {event.newLegIds
                        .map((legId) => legsById.get(legId)?.contractCode ?? legId)
                        .join(' / ')}
                    </strong>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-inline">这笔交易还没有后续仓位事件。</div>
      )}
    </section>
  )
}
