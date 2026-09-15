import '@fontsource-variable/inter'
import '@fontsource/cinzel/600.css'
import '@fontsource/pirata-one/400.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/monoton/400.css'
import '@fontsource/share-tech-mono/400.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './scenes.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
