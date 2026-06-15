import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tokens.css'
import { AppRouter } from './router'

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>
)
