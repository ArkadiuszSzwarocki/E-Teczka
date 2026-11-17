import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import DeveloperPanel from './components/DeveloperPanel'
import AccessLock from './AccessLock.tsx'
import AccountGate from './components/AccountGate'
import './index.css'
import { initTheme } from './services/theme'
import { initAppZoom } from './services/appZoom'

initTheme();
initAppZoom();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname === '/developer' ? <DeveloperPanel /> : <AccountGate><AccessLock optionalSetup><App /></AccessLock></AccountGate>}
  </React.StrictMode>,
)
