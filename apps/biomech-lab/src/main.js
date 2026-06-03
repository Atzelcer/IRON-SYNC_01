import './styles/app.css';

import { UiController } from './ui/uiController.js';

const root = document.querySelector('#app');

try {
  const app = new UiController(root);
  app.start();
} catch (error) {
  console.error('[biomech-lab] startup failed', error);
  if (root) {
    root.innerHTML = `
      <div style="padding:24px;font-family:system-ui,sans-serif;color:#eef3f7;background:#0b1015;min-height:100vh">
        <h1 style="color:#ff6b6b">Error al iniciar el laboratorio</h1>
        <pre style="white-space:pre-wrap;color:#9fd6e6">${error?.message ?? error}</pre>
      </div>`;
  }
}
