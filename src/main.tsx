import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './features/auth/AuthContext';
import { initializeAppUpdates } from '@platform/app-update';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('عنصر تشغيل التطبيق root غير موجود في الصفحة.');

// Registered in prompt mode: a new build waits for the operator instead of
// swapping the app underneath a half-filled form.
void initializeAppUpdates();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
