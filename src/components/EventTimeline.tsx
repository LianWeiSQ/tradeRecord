import { formatDateTime, formatEventType, formatMoney } from '../services/format'
import type { PositionEvent, StrategyLeg } from '../types/trade'

interface EventTimelineProps {
  events: PositionEvent[]
  legs: StrategyLeg[]
  onEditEvent?: (event: PositionEvent) => void
  onDeleteEvent?: (event: PositionEvent) => void
}

export function EventTimeline({
  events,
  legs,
  onEditEvent,
  onDeleteEvent,
}: EventTimelineProps) {
  const ordered = [...events].sort(
    (left, right) => new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime(),
  )
  const legsById = new Map(legs.map((leg) => [leg.id, leg]))

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <h3>仓位事件</h3>
          <p>所有加仓、减仓、平仓和移仓都作为事件挂在这条交易下面，编辑或删除会触发整条历史回算。</p>
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
                <div className="tag-row">
                  {event.isInitial ? <span className="pill">初始开仓</span> : null}
                  {!event.isInitial && onEditEvent ? (
                    <button
                      className="btn btn--ghost"
                      type="button"
                      onClick={() => onEditEvent(event)}
                    >
                      编辑
                    </button>
                  ) : null}
                  {!event.isInitial && onDeleteEvent ? (
                    <button
                      className="btn btn--ghost"
                      type="button"
                      onClick={() => onDeleteEvent(event)}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </div>

              {event.note ? <p>{event.note}</p> : null}

              <div className="list-stack">
                {event.legChanges.map((change) => {
                  const leg = legsById.get(change.legId)

                  return (
                    <div className="kv" key={`${event.id}-${change.legId}`}>
                      <span>{leg?.contractCode ?? change.legId}</span>
                      <strong>
                        数量变动 {change.quantityChange > 0 ? '+' : ''}
                        {change.quantityChange} / 成交价 {formatMoney(change.price)}
                      </strong>
                    </div>
                  )
                })}

                {event.newLegIds.length ? (
                  <div className="kv">
                    <span>新增腿</span>
                    <strong>
                      {event.newLegIds
                        .map((legId) => legsById.get(legId)?.contractCode ?? legId)
                        .join(' / ')}
                    </strong>
                  </div>
                ) : null}

                <div className="kv">
                  <span>审计</span>
                  <strong>
                    {event.audit.sourceLabel} / {event.audit.lastModifiedType} /{' '}
                    {formatDateTime(event.audit.lastModifiedAt)}
                  </strong>
                </div>
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
