import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Preview from './Preview.tsx'

document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)

createRoot(document.getElementById('root')!).render(
  location.pathname === '/preview' ? <Preview /> : <App />,
)
