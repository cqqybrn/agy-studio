import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeApp } from './stores/bootstrap';
import { captureTokenFromUrl } from './api/http';
import './index.css';

// Must run before the first API call / WebSocket connection.
captureTokenFromUrl();
initializeApp({ autoFetch: true });

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
