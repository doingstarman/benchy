import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App } from './App'
import { NewRun } from './pages/NewRun'
import { Results } from './pages/Results'
import { History } from './pages/History'
import { Providers } from './pages/Providers'
import { Library } from './pages/Library'
import { Datasets } from './pages/Datasets'
import { DatasetDetail } from './pages/DatasetDetail'
import { Settings } from './pages/Settings'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/run" replace />} />
          <Route path="run" element={<NewRun />} />
          <Route path="results/:runId" element={<Results />} />
          <Route path="history" element={<History />} />
          <Route path="providers" element={<Providers />} />
          <Route path="library" element={<Library />} />
          <Route path="datasets" element={<Datasets />} />
          <Route path="datasets/:id" element={<DatasetDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
