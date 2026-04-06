import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useLiveQuotes } from './LiveQuotesProvider'
import { formatDateTime } from '../services/format'
import type { NavigationItem } from '../types/trade'

const navigationItems: NavigationItem[] = [
  { to: '/', label: '首页', shortLabel: '首页', icon: 'DB' },
  { to: '/positions/new', label: '开仓', shortLabel: '开仓', icon: 'OP' },
  { to: '/valuations', label: '估值', shortLabel: '估值', icon: 'MT' },
  { to: '/import', label: '导入', shortLabel: '导入', icon: 'IM' },
]

function pageMeta(pathname: string) {
  if (pathname.startsWith('/positions/new')) {
    return {
      title: '开仓',
      description: '只记录建立一笔交易所需的最小信息，后续变化都回到详情页继续维护。',
    }
  }

  if (pathname.startsWith('/positions/')) {
    return {
      title: '交易详情',
      description: '集中处理持仓明细、仓位事件、自动行情、正式估值与复盘。',
    }
  }

  if (pathname.startsWith('/valuations')) {
    return {
      title: '估值',
      description: '自动读取期货与标的行情，期权继续手动补录，并保存正式估值快照。',
    }
  }

  if (pathname.startsWith('/import')) {
    return {
      title: 'Excel 导入',
      description: '按固定模板导入历史记录，先解析预览，再保存到 Python 后端。',
    }
  }

  return {
    title: '交易工作台',
    description: '围绕当前持仓、实时收益、正式估值和后续管理来组织你的日常记录。',
  }
}

function formatHealthLabel(status: 'ok' | 'degraded' | 'offline') {
  if (status === 'ok') {
    return '行情正常'
  }

  if (status === 'degraded') {
    return '行情待刷新'
  }

  return '行情离线'
}

export function AppLayout() {
  const location = useLocation()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const { health, lastSynchronizedAt } = useLiveQuotes()

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname])

  const meta = useMemo(() => pageMeta(location.pathname), [location.pathname])
  const primaryAction = location.pathname === '/' ? '/positions/new' : '/'

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-shell--collapsed' : ''}`}>
      <aside className={`app-sidebar ${mobileNavOpen ? 'app-sidebar--open' : ''}`}>
        <div className="app-sidebar__header">
          <Link className="sidebar-brand" to="/">
            <div className="sidebar-brand__mark">TR</div>
            <div className="sidebar-brand__text">
              <strong>Trade Record</strong>
              <span>Python 后端版工作台</span>
            </div>
          </Link>
          <button
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            className="sidebar-toggle desktop-only"
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? '>' : '<'}
          </button>
          <button
            aria-label="关闭菜单"
            className="sidebar-toggle mobile-only"
            type="button"
            onClick={() => setMobileNavOpen(false)}
          >
            x
          </button>
        </div>

        <div className="app-sidebar__meta">
          <span className="toolbar-chip">单用户</span>
          <span className="toolbar-chip">FastAPI</span>
        </div>

        <nav className="sidebar-nav">
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              className={({ isActive }) => `sidebar-nav__item ${isActive ? 'is-active' : ''}`}
              end={item.to === '/'}
              to={item.to}
            >
              <span className="sidebar-nav__icon">{item.icon}</span>
              <span className="sidebar-nav__label">
                {sidebarCollapsed ? item.shortLabel : item.label}
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-note">
          <strong>当前流程</strong>
          <p>开仓只做一次，后续加仓、减仓、平仓、移仓、估值和复盘都在原记录里继续追加。</p>
        </div>
      </aside>

      {mobileNavOpen ? (
        <button
          aria-label="关闭侧边栏遮罩"
          className="sidebar-scrim"
          type="button"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      <div className="app-workspace">
        <header className="app-topbar">
          <div className="app-topbar__title">
            <button
              aria-label="打开导航菜单"
              className="sidebar-toggle mobile-only"
              type="button"
              onClick={() => setMobileNavOpen(true)}
            >
              =
            </button>
            <div>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </div>
          </div>

          <div className="app-topbar__actions">
            <div className="toolbar-chip-group">
              <span className="toolbar-chip">{formatHealthLabel(health.status)}</span>
              <span className="toolbar-chip">
                {lastSynchronizedAt ? `最新行情 ${formatDateTime(lastSynchronizedAt)}` : '尚未刷新行情'}
              </span>
            </div>
            <div className="toolbar-actions">
              <Link className="btn btn--secondary" to={primaryAction}>
                {location.pathname === '/' ? '去开仓' : '返回首页'}
              </Link>
              <Link className="btn" to="/valuations">
                去估值
              </Link>
            </div>
          </div>
        </header>

        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
