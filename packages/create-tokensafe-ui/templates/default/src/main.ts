import { mount } from 'tokensafe-ui';
import { App } from './App.js';

const container = document.getElementById('app');
if (container) {
  mount(App(), container);
}
