import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import DeveloperPanel from './components/DeveloperPanel'
import AccessLock from './AccessLock.tsx'
import AccountGate from './components/AccountGate'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {window.location.pathname === '/developer' ? <AccessLock><DeveloperPanel /></AccessLock> : <AccountGate><AccessLock optionalSetup><App /></AccessLock></AccountGate>}
  </React.StrictMode>,
)
