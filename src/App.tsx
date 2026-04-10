import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { LiveQuotesProvider } from './components/LiveQuotesProvider'
import { TradeDataProvider } from './components/TradeDataProvider'
import { NewPositionPage } from './pages/NewPositionPage'
import { PositionDetailPage } from './pages/PositionDetailPage'
import { PositionListPage } from './pages/PositionListPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <PositionListPage /> },
      { path: 'positions/new', element: <NewPositionPage /> },
      { path: 'positions/:positionId', element: <PositionDetailPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

function App() {
  return (
    <TradeDataProvider>
      <LiveQuotesProvider>
        <RouterProvider router={router} />
      </LiveQuotesProvider>
    </TradeDataProvider>
  )
}

export default App
