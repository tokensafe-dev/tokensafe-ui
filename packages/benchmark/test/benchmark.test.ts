import { describe, it, expect } from 'vitest';
import { MockTaskBackend } from '../src/oracle/mock-api.js';
import { TaskManagerOracle } from '../src/oracle/task-manager-oracle.js';
import { MetricsCollector } from '../src/runner/metrics-collector.js';
import { BenchmarkHarness } from '../src/runner/harness.js';
import { BenchmarkReporter } from '../src/runner/reporter.js';
import { createReactTaskManagerAdapter } from '../sandboxes/react-task-manager/src/adapter.js';
import { createTokenSafeTaskManagerAdapter } from '../sandboxes/tokensafe-task-manager/src/adapter.js';

describe('Agent Usability Benchmark (AUB)', () => {
  describe('MockTaskBackend', () => {
    it('fetches initial tasks and records calls', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 0 });
      const tasks = await backend.fetchTasks();
      expect(tasks.length).toBeGreaterThan(0);
      expect(backend.getCallCounts().fetch).toBe(1);
    });

    it('injects single-shot failure on save', async () => {
      const backend = new MockTaskBackend({ networkLatencyMs: 0, shouldFail: true });
      await expect(backend.saveTasks([])).rejects.toThrow(/HTTP 500/);
      // Next call should succeed (single-shot)
      const res = await backend.saveTasks([]);
      expect(res.success).toBe(true);
    });
  });

  describe('TaskManagerOracle (12 Assertions)', () => {
    it('evaluates React sandbox at 100% functional pass rate (12/12)', async () => {
      const oracle = new TaskManagerOracle();
      const report = await oracle.evaluate((backend) => createReactTaskManagerAdapter(backend));

      expect(report.passedCount).toBe(12);
      expect(report.totalCount).toBe(12);
      expect(report.allPassed).toBe(true);
      expect(report.assertions.every((a) => a.passed)).toBe(true);
    });

    it('evaluates TokenSafe UI sandbox at 100% functional pass rate (12/12)', async () => {
      const oracle = new TaskManagerOracle();
      const report = await oracle.evaluate((backend) => createTokenSafeTaskManagerAdapter(backend));

      expect(report.passedCount).toBe(12);
      expect(report.totalCount).toBe(12);
      expect(report.allPassed).toBe(true);
      expect(report.assertions.every((a) => a.passed)).toBe(true);
    });
  });

  describe('MetricsCollector & North Star Formulations', () => {
    it('computes Functional Yield per Token (FYpT) and detects regressions', () => {
      const collector = new MetricsCollector('react', 'task-manager');
      collector.start();

      // Turn 1: 2 assertions pass
      collector.recordTurn({
        inputTokens: 1000,
        outputTokens: 200,
        durationMs: 1000,
        toolCalls: [],
        hasSyntaxError: false,
        hasTypeError: false,
        hasRuntimeError: false,
        passedAssertions: ['TC01_INITIAL_MOUNT', 'TC02_ADD_TASK'],
      });

      // Turn 2: TC02 regresses (breaks)
      const turn2 = collector.recordTurn({
        inputTokens: 1500,
        outputTokens: 300,
        durationMs: 1200,
        toolCalls: [],
        hasSyntaxError: false,
        hasTypeError: false,
        hasRuntimeError: true,
        errorMessage: 'State reset error',
        passedAssertions: ['TC01_INITIAL_MOUNT'],
      });

      expect(turn2.regressions).toContain('TC02_ADD_TASK');

      // Turn 3: Recovers from error, all pass
      const turn3 = collector.recordTurn({
        inputTokens: 2000,
        outputTokens: 400,
        durationMs: 1400,
        toolCalls: [],
        hasSyntaxError: false,
        hasTypeError: false,
        hasRuntimeError: false,
        passedAssertions: ['TC01_INITIAL_MOUNT', 'TC02_ADD_TASK'],
      });

      expect(turn3.recoveredFromPreviousError).toBe(true);

      collector.stop();
      const result = collector.finalize(2);

      expect(result.regressionCount).toBe(1);
      expect(result.totalTokens).toBe(1200 + 1800 + 2400); // 5400
      // FYpT = (2 / 5400) * 1000 = 0.3704
      expect(result.functionalYieldPerToken).toBeCloseTo(0.3704, 2);
    });

    it('computes Autonomous Efficiency Ratio (AER) across competing stacks', () => {
      const reactCollector = new MetricsCollector('react');
      reactCollector.recordTurn({
        inputTokens: 10000,
        outputTokens: 2000,
        durationMs: 5000,
        toolCalls: [],
        hasSyntaxError: false,
        hasTypeError: false,
        hasRuntimeError: false,
        passedAssertions: ['TC01', 'TC02'],
      });
      const reactResult = reactCollector.finalize(2);

      const tokenSafeCollector = new MetricsCollector('tokensafe');
      tokenSafeCollector.recordTurn({
        inputTokens: 2000,
        outputTokens: 400,
        durationMs: 1500,
        toolCalls: [],
        hasSyntaxError: false,
        hasTypeError: false,
        hasRuntimeError: false,
        passedAssertions: ['TC01', 'TC02'],
      });
      const tokenSafeResult = tokenSafeCollector.finalize(2);

      const summary = MetricsCollector.compare(reactResult, tokenSafeResult);
      expect(summary.autonomousEfficiencyRatio).toBeGreaterThan(1.0);
      expect(summary.autonomousEfficiencyRatio).toBeCloseTo(5.0, 1);
      expect(summary.tokenSavingsPct).toBe(80);
    });
  });

  describe('BenchmarkHarness & Replay Engine', () => {
    it('executes full replay benchmark and outputs comparative scorecard', async () => {
      const harness = new BenchmarkHarness({ scenario: 'task-manager' });
      const summary = await harness.runReplayBenchmark();

      expect(summary.react.passed).toBe(true);
      expect(summary.tokensafe.passed).toBe(true);
      expect(summary.autonomousEfficiencyRatio).toBeGreaterThan(2.0);
      expect(summary.tokenSavingsPct).toBeGreaterThan(50);
      expect(summary.turnReductionPct).toBeGreaterThan(30);

      const terminalText = BenchmarkReporter.formatTerminal(summary);
      expect(terminalText).toContain('AGENT USABILITY BENCHMARK');
      expect(terminalText).toContain('Autonomous Efficiency Ratio');

      const mdText = BenchmarkReporter.formatMarkdown(summary);
      expect(mdText).toContain('# Agent Usability Benchmark (AUB) Report');
      expect(mdText).toContain('Functional Yield per 1k Tokens (FYpT)');
    });
  });
});
