import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import App from './App';
import { theme } from './theme';
import { initPwa } from './lib/pwa';

// Attach the install-prompt listener before the first render, so a prompt that
// arrives early is not missed. The service worker is production-only: a dev
// server that caches its own module graph is a debugging trap.
initPwa({ serviceWorker: import.meta.env.PROD });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
);
