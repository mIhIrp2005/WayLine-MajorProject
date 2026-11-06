import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

try {
  localStorage.removeItem('wayline_theme');
  document.documentElement.removeAttribute('data-theme');
} catch {}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
