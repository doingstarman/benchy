import { lazy, type ComponentType } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { App } from './App'
import { NewRun } from './pages/NewRun'
import { useStartView } from './prefs'

// Route-based code splitting: every page but /run loads on demand, so the initial
// bundle carries only the shell + the start screen. NewRun stays eager — it is the
// usual start view and the app shell imports its session helpers regardless.
const named = (p: Promise<Record<string, unknown>>, key: string) => p.then(m => ({ default: m[key] as ComponentType }))
const Results = lazy(() => named(import('./pages/Results'), 'Results'))
const ResultsDb = lazy(() => named(import('./pages/ResultsDb'), 'ResultsDb'))
const History = lazy(() => named(import('./pages/History'), 'History'))
const Providers = lazy(() => named(import('./pages/Providers'), 'Providers'))
const Models = lazy(() => named(import('./pages/Models'), 'Models'))
const Agents = lazy(() => named(import('./pages/Agents'), 'Agents'))
const Pipelines = lazy(() => named(import('./pages/Pipelines'), 'Pipelines'))
const Dashboard = lazy(() => named(import('./pages/Dashboard'), 'Dashboard'))
const Library = lazy(() => named(import('./pages/Library'), 'Library'))
const Datasets = lazy(() => named(import('./pages/Datasets'), 'Datasets'))
const DatasetDetail = lazy(() => named(import('./pages/DatasetDetail'), 'DatasetDetail'))
const Settings = lazy(() => named(import('./pages/Settings'), 'Settings'))

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
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="results" element={<ResultsDb />} />
          <Route path="results/:runId" element={<Results />} />
          <Route path="history" element={<History />} />
          <Route path="providers" element={<Providers />} />
          <Route path="models" element={<Models />} />
          <Route path="agents" element={<Agents />} />
          <Route path="pipelines" element={<Pipelines />} />
          <Route path="library" element={<Library />} />
          <Route path="datasets" element={<Datasets />} />
          <Route path="datasets/:id" element={<DatasetDetail />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
