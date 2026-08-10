import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App } from './App'
import { NewRun } from './pages/NewRun'
import { Results } from './pages/Results'
import { ResultsDb } from './pages/ResultsDb'
import { History } from './pages/History'
import { Providers } from './pages/Providers'
import { Library } from './pages/Library'
import { Datasets } from './pages/Datasets'
import { DatasetDetail } from './pages/DatasetDetail'
import { Settings } from './pages/Settings'
import { useStartView } from './prefs'

// "/" is not a page — it forwards to whichever one the user chose to open on.
function StartRedirect() {
  return <Navigate to={useStartView()} replace />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<StartRedirect />} />
          <Route path="run" element={<NewRun />} />
          <Route path="results" element={<ResultsDb />} />
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
