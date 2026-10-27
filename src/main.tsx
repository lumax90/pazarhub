import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { I18nProvider } from 'react-aria-components'
import { App } from './app/App'
import { AppProvider } from './app/AppProvider'
import { SessionGate } from './app/SessionGate'
import { ErrorBoundary } from './app/ErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider locale="tr-TR">
      <BrowserRouter>
        <AppProvider>
          <ErrorBoundary>
            <SessionGate>
              <App />
            </SessionGate>
          </ErrorBoundary>
        </AppProvider>
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
