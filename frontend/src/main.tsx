import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeApp } from './stores/bootstrap';
import './index.css';

initializeApp({ autoFetch: true });

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
