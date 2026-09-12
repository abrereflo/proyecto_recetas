import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Single source of truth shared with design/mockups/. A colour or spacing
// change lands in the mockups and the apps at once (docs/17).
import '../../../design/tokens.css';
import '../../../design/components.css';

import { App } from './App';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('#root not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
