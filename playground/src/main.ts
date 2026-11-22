import { VERSION } from '@agent-dom/core';

console.log('agent-dom playground loaded, core version:', VERSION);
const app = document.getElementById('app');
if (app) {
  app.innerHTML = `<h1>agent-dom Playground</h1><p>Core version: ${VERSION}</p>`;
}
