import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import '@yourco/forms/styles.css';

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// The demo API must be intercepting before the form loads a draft or a key.
// Checked inline (not via isDemo) so the bundler drops MSW from normal builds.
if (import.meta.env.VITE_DEMO === 'true') {
  import('./demo/browser')
    .then(({ startDemoApi }) => startDemoApi())
    .catch((err) => console.error('Demo API failed to start', err))
    .finally(render);
} else {
  render();
}
