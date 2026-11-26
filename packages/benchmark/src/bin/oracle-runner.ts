#!/usr/bin/env node
/**
 * Headless oracle runner for the benchmark harness.
 *
 * Boots happy-dom, mounts the real React sandbox and prints one JSON line:
 *   {"passed": 12, "failed": []}
 *
 * The agent never edits this file (writes are restricted to the sandbox sources),
 * and `tokensafe bench-oumv --target react` shells out to it after every step.
 */
import { Window } from 'happy-dom';

if (typeof document === 'undefined') {
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).customElements = win.customElements;
}

const { TaskManagerOracle } = await import('../oracle/task-manager-oracle.js');
const { createReactTaskManagerAdapter } = await import(
  '../../sandboxes/react-task-manager/src/adapter.js'
);

const report = await new TaskManagerOracle().evaluate((backend: any) =>
  createReactTaskManagerAdapter(backend)
);

const failed = report.assertions.filter((a) => !a.passed).map((a) => a.id);
process.stdout.write(JSON.stringify({ passed: report.passedCount, failed }) + '\n');
