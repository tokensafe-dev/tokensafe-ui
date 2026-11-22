import { mount } from '@agent-dom/core';
import { getSemanticSnapshot } from '@agent-dom/observer';
import { TaskBoard } from './App.js';

const appContainer = document.getElementById('app');
if (appContainer) {
  const instance = TaskBoard();
  mount(instance, appContainer);

  const snapshot = getSemanticSnapshot(appContainer);
  console.log('--- Initial AgentDOM Semantic Snapshot ---');
  console.log(snapshot);

  // Broadcast to Vite DevServer WebSocket if running in browser
  if (import.meta.hot) {
    import.meta.hot.send('agent-dom:snapshot', { snapshot });
  }
}
