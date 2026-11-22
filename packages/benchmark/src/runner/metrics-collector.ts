import type {
  StackType,
  AgentTurnRecord,
  BenchmarkRunResult,
  ComparativeSummary,
} from '../types.js';

export interface PricingConfig {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const DEFAULT_PRICING: PricingConfig = {
  inputPerMillionUsd: 3.0, // Standard frontier model input price
  outputPerMillionUsd: 15.0, // Standard frontier model output price
};

export class MetricsCollector {
  private stack: StackType;
  private scenario: string;
  private turns: AgentTurnRecord[] = [];
  private startTime: number = 0;
  private endTime: number = 0;
  private pricing: PricingConfig;
  private previouslyPassedAssertions: Set<string> = new Set();
  private totalRegressions: number = 0;

  constructor(stack: StackType, scenario: string = 'task-manager', pricing: PricingConfig = DEFAULT_PRICING) {
    this.stack = stack;
    this.scenario = scenario;
    this.pricing = pricing;
  }

  public start(): void {
    this.startTime = performance.now();
  }

  public stop(): void {
    this.endTime = performance.now();
  }

  public recordTurn(data: Omit<AgentTurnRecord, 'turn' | 'stack' | 'totalTokens' | 'regressions' | 'recoveredFromPreviousError'>): AgentTurnRecord {
    const turnIndex = this.turns.length + 1;
    const totalTokens = data.inputTokens + data.outputTokens;

    // Detect regressions: assertions passed in prior turns but missing now
    const currentPassed = new Set(data.passedAssertions);
    const regressions: string[] = [];
    for (const priorAssertion of this.previouslyPassedAssertions) {
      if (!currentPassed.has(priorAssertion)) {
        regressions.push(priorAssertion);
      }
    }
    this.totalRegressions += regressions.length;

    // Update cumulative passed assertions
    for (const a of data.passedAssertions) {
      this.previouslyPassedAssertions.add(a);
    }

    // Detect self recovery: if previous turn had error and this turn has no error
    const prevTurn = this.turns[this.turns.length - 1];
    const prevHadError = prevTurn && (prevTurn.hasSyntaxError || prevTurn.hasTypeError || prevTurn.hasRuntimeError);
    const currentHasError = data.hasSyntaxError || data.hasTypeError || data.hasRuntimeError;
    const recovered = Boolean(prevHadError && !currentHasError);

    const record: AgentTurnRecord = {
      ...data,
      turn: turnIndex,
      stack: this.stack,
      totalTokens,
      regressions,
      recoveredFromPreviousError: recovered,
    };

    this.turns.push(record);
    return record;
  }

  public finalize(totalAvailableAssertions: number = 12): BenchmarkRunResult {
    if (this.endTime === 0) {
      this.stop();
    }

    const wallClockSeconds = Number(((this.endTime - this.startTime) / 1000).toFixed(2));
    const totalTurns = this.turns.length;

    let inputTokens = 0;
    let outputTokens = 0;
    let errorCount = 0;
    let errorTurns = 0;
    let recoveryTurns = 0;

    for (const turn of this.turns) {
      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;
      if (turn.hasSyntaxError || turn.hasTypeError || turn.hasRuntimeError) {
        errorCount++;
        errorTurns++;
      }
      if (turn.recoveredFromPreviousError) {
        recoveryTurns++;
      }
    }

    const totalTokens = inputTokens + outputTokens;

    // Context Slope (Delta C): average input token growth per turn
    let contextSlope = 0;
    if (this.turns.length > 1) {
      const firstInput = this.turns[0].inputTokens;
      const lastInput = this.turns[this.turns.length - 1].inputTokens;
      contextSlope = Math.round((lastInput - firstInput) / (this.turns.length - 1));
    }

    // Self-Recovery Rate
    const selfRecoveryRate = errorTurns > 0 ? Math.round((recoveryTurns / errorTurns) * 100) : 100;

    // Passed Assertions in the final turn
    const lastTurn = this.turns[this.turns.length - 1];
    const passedAssertionsCount = lastTurn ? lastTurn.passedAssertions.length : 0;
    const allPassed = passedAssertionsCount === totalAvailableAssertions;

    // North Star Metric: Functional Yield per Token (FYpT)
    // Formula: (Passed Assertions / Total Tokens) * 1,000
    const functionalYieldPerToken = totalTokens > 0
      ? Number(((passedAssertionsCount / totalTokens) * 1000).toFixed(4))
      : 0;

    // Cost calculation
    const inputCost = (inputTokens / 1_000_000) * this.pricing.inputPerMillionUsd;
    const outputCost = (outputTokens / 1_000_000) * this.pricing.outputPerMillionUsd;
    const costUsd = Number((inputCost + outputCost).toFixed(4));
    const costYield = costUsd > 0 ? Number((passedAssertionsCount / costUsd).toFixed(2)) : 0;

    return {
      stack: this.stack,
      scenario: this.scenario,
      totalTurns,
      inputTokens,
      outputTokens,
      totalTokens,
      contextSlope,
      wallClockSeconds,
      passedAssertionsCount,
      totalAssertionsCount: totalAvailableAssertions,
      errorCount,
      regressionCount: this.totalRegressions,
      selfRecoveryRate,
      functionalYieldPerToken,
      costUsd,
      costYield,
      turns: this.turns,
      passed: allPassed,
    };
  }

  public static compare(react: BenchmarkRunResult, tokensafe: BenchmarkRunResult): ComparativeSummary {
    // Autonomous Efficiency Ratio (AER): FYpT_tokensafe / FYpT_react
    const aer = react.functionalYieldPerToken > 0
      ? Number((tokensafe.functionalYieldPerToken / react.functionalYieldPerToken).toFixed(2))
      : tokensafe.functionalYieldPerToken > 0 ? 999 : 1.0;

    const tokenSavingsPct = react.totalTokens > 0
      ? Math.round(((react.totalTokens - tokensafe.totalTokens) / react.totalTokens) * 100)
      : 0;

    const turnReductionPct = react.totalTurns > 0
      ? Math.round(((react.totalTurns - tokensafe.totalTurns) / react.totalTurns) * 100)
      : 0;

    const latencyReductionPct = react.wallClockSeconds > 0
      ? Math.round(((react.wallClockSeconds - tokensafe.wallClockSeconds) / react.wallClockSeconds) * 100)
      : 0;

    const regressionReductionPct = react.regressionCount > 0
      ? Math.round(((react.regressionCount - tokensafe.regressionCount) / react.regressionCount) * 100)
      : tokensafe.regressionCount === 0 ? 100 : 0;

    const summaryText =
      `TokenSafe UI achieved an Autonomous Efficiency Ratio (AER) of ${aer}x ` +
      `with ${tokenSavingsPct}% fewer tokens, ${turnReductionPct}% fewer iterations, ` +
      `and ${regressionReductionPct}% fewer regressions compared to React.`;

    return {
      scenario: react.scenario,
      timestamp: new Date().toISOString(),
      react,
      tokensafe,
      autonomousEfficiencyRatio: aer,
      tokenSavingsPct,
      turnReductionPct,
      latencyReductionPct,
      regressionReductionPct,
      summaryText,
    };
  }
}
