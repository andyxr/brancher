import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { LiquidGlassFilter } from './LiquidGlassFilter.tsx';
import './theme.ts'; // Applies the saved theme before the first paint.
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiquidGlassFilter />
    <App />
  </StrictMode>,
);
