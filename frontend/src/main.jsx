import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../node_modules/@fontsource/noto-sans/latin-400.css'
import '../node_modules/@fontsource/noto-sans/latin-500.css'
import '../node_modules/@fontsource/noto-sans/latin-600.css'
import '../node_modules/@fontsource/noto-sans/latin-700.css'
import '../node_modules/@fontsource/noto-sans-khmer/khmer-400.css'
import '../node_modules/@fontsource/noto-sans-khmer/khmer-500.css'
import '../node_modules/@fontsource/noto-sans-khmer/khmer-600.css'
import '../node_modules/@fontsource/noto-sans-khmer/khmer-700.css'
import './index.css'
import './i18n'
import App from './App.jsx'
import { STORE } from './config/store.js'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { SettingsProvider } from './context/SettingsContext.jsx'
import { initPwa } from './utils/pwaInstall.js'

if (typeof document !== 'undefined') {
  document.title = STORE.documentTitle
}

// Before render: the install prompt event fires once, early in page load.
initPwa()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </ThemeProvider>
  </StrictMode>,
)
