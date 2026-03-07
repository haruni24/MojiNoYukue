import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { SettingsApp } from './settings/SettingsApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
)

