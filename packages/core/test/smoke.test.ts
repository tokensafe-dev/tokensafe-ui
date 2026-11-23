import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('agent-dom core smoke test', () => {
  it('exports valid version string', () => {
    expect(VERSION).toBe('0.2.0');
  });
});
