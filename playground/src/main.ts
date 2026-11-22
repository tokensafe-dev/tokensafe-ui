import { mount } from 'tokensafe-ui';
import { getSemanticSnapshot } from 'tokensafe-ui/observer';
import { TaskBoard } from './App.js';
import { OrderCheckout } from './OrderCheckout.js';

const appContainer = document.getElementById('app');
if (appContainer) {
  const taskBoardInstance = TaskBoard();
  const orderCheckoutInstance = OrderCheckout();

  const wrapper = document.createElement('div');
  wrapper.className = 'playground-root';
  appContainer.appendChild(wrapper);

  mount(taskBoardInstance, wrapper);
  mount(orderCheckoutInstance, wrapper);

  const snapshot = getSemanticSnapshot(appContainer);
  console.log('--- Initial AgentDOM Semantic Snapshot ---');
  console.log(snapshot);

  // Broadcast to Vite DevServer WebSocket if running in browser
  if (import.meta.hot) {
    import.meta.hot.send('agent-dom:snapshot', { snapshot });
  }
}
