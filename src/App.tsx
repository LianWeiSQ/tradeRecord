import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { LiveQuotesProvider } from './components/LiveQuotesProvider'
import { TradeDataProvider } from './components/TradeDataProvider'
import { DashboardPage } from './pages/DashboardPage'
import { ImportPage } from './pages/ImportPage'
import { NewPositionPage } from './pages/NewPositionPage'
import { PositionDetailPage } from './pages/PositionDetailPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { ValuationPage } from './pages/ValuationPage'

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'positions/new', element: <NewPositionPage /> },
      { path: 'positions/:positionId', element: <PositionDetailPage /> },
      { path: 'reviews', element: <ReviewsPage /> },
      { path: 'valuations', element: <ValuationPage /> },
      { path: 'import', element: <ImportPage /> },
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
