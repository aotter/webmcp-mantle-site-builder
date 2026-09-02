import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Preview from './Preview.tsx'

const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
const applyColorScheme = () => {
  const savedTheme = localStorage.getItem('mantle-builder-theme')
  document.documentElement.classList.toggle('dark', savedTheme ? savedTheme === 'dark' : colorScheme.matches)
}
applyColorScheme()
colorScheme.addEventListener('change', () => {
  if (!localStorage.getItem('mantle-builder-theme')) applyColorScheme()
})

createRoot(document.getElementById('root')!).render(
  location.pathname === '/preview' ? <Preview /> : <App />,
)
