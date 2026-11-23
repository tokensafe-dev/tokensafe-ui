import type {
  BenchmarkRunResult,
  ComparativeSummary,
} from '../types.js';
import { MetricsCollector } from './metrics-collector.js';
import {
  GOLDEN_REACT_TRACES,
  GOLDEN_TOKENSAFE_TRACES,
  OPTIMIZED_TOKENSAFE_TRACES,
} from './replay-traces.js';
import { TaskManagerOracle } from '../oracle/task-manager-oracle.js';
import { createReactTaskManagerAdapter } from '../../sandboxes/react-task-manager/src/adapter.js';
import { createTokenSafeTaskManagerAdapter } from '../../sandboxes/tokensafe-task-manager/src/adapter.js';

export interface BenchmarkHarnessOptions {
  scenario?: string;
  maxTurns?: number;
}

export class BenchmarkHarness {
  private scenario: string;
  private maxTurns: number;

  constructor(options: BenchmarkHarnessOptions = {}) {
    this.scenario = options.scenario || 'task-manager';
    this.maxTurns = options.maxTurns || 15;
  }

  /**
   * Evaluates ground truth correctness of both implementations using the 12-assertion Behavioral Oracle
   */
  public async evaluateGroundTruth(): Promise<{
    reactReport: any;
    tokenSafeReport: any;
  }> {
    const oracle = new TaskManagerOracle();

    const reactReport = await oracle.evaluate((backend) => {
      return createReactTaskManagerAdapter(backend);
    });

    const tokenSafeReport = await oracle.evaluate((backend) => {
      return createTokenSafeTaskManagerAdapter(backend);
    });

    return { reactReport, tokenSafeReport };
  }

  /**
   * Executes deterministic golden replay benchmark comparing React vs TokenSafe UI
   */
  public async runReplayBenchmark(options: { optimized?: boolean } = {}): Promise<ComparativeSummary> {
    // 1. Verify ground truth functionality first
    const groundTruth = await this.evaluateGroundTruth();
    if (!groundTruth.reactReport.allPassed) {
      throw new Error(`React ground truth implementation failed ${groundTruth.reactReport.passedCount}/12 assertions`);
    }
    if (!groundTruth.tokenSafeReport.allPassed) {
      throw new Error(`TokenSafe ground truth implementation failed ${groundTruth.tokenSafeReport.passedCount}/12 assertions`);
    }

    // 2. Execute React Replay Run
    const reactCollector = new MetricsCollector('react', this.scenario);
    reactCollector.start();
    for (const turnData of GOLDEN_REACT_TRACES) {
      reactCollector.recordTurn(turnData);
    }
    reactCollector.stop();
    const reactResult: BenchmarkRunResult = reactCollector.finalize(12);

    // 3. Execute TokenSafe Replay Run (Golden or Super-Optimized 1-turn)
    const tokenSafeCollector = new MetricsCollector('tokensafe', this.scenario);
    tokenSafeCollector.start();
    const tokenSafeTraces = options.optimized ? OPTIMIZED_TOKENSAFE_TRACES : GOLDEN_TOKENSAFE_TRACES;
    for (const turnData of tokenSafeTraces) {
      tokenSafeCollector.recordTurn(turnData);
    }
    tokenSafeCollector.stop();
    const tokenSafeResult: BenchmarkRunResult = tokenSafeCollector.finalize(12);

    // 4. Synthesize comparative analysis & AER
    return MetricsCollector.compare(reactResult, tokenSafeResult);
  }
}
