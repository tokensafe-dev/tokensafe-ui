/**
 * Telemetry and metrics types for Agent Usability Benchmark (AUB / AUI-Bench)
 */

export type StackType = 'react' | 'tokensafe';

export interface AgentToolCallRecord {
  name: string;
  args?: Record<string, any>;
  durationMs?: number;
  outputSummary?: string;
  isError?: boolean;
}

export interface AgentTurnRecord {
  turn: number;
  stack: StackType;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  toolCalls: AgentToolCallRecord[];
  durationMs: number;
  hasSyntaxError: boolean;
  hasTypeError: boolean;
  hasRuntimeError: boolean;
  errorMessage?: string;
  passedAssertions: string[];
  regressions: string[];
  recoveredFromPreviousError: boolean;
}

export interface OracleAssertionResult {
  id: string;
  title: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

export interface OracleEvaluationReport {
  passedCount: number;
  totalCount: number;
  assertions: OracleAssertionResult[];
  allPassed: boolean;
  durationMs: number;
}

export interface BenchmarkRunResult {
  stack: StackType;
  scenario: string;
  totalTurns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextSlope: number; // avg token increase per turn
  wallClockSeconds: number;
  passedAssertionsCount: number;
  totalAssertionsCount: number;
  errorCount: number;
  regressionCount: number;
  selfRecoveryRate: number; // 0 - 100%
  functionalYieldPerToken: number; // FYpT: (passed / totalTokens) * 1000
  costUsd: number;
  costYield: number; // passed / costUsd
  turns: AgentTurnRecord[];
  passed: boolean;
}

export interface ComparativeSummary {
  scenario: string;
  timestamp: string;
  react: BenchmarkRunResult;
  tokensafe: BenchmarkRunResult;
  autonomousEfficiencyRatio: number; // AER: FYpT_tokensafe / FYpT_react
  tokenSavingsPct: number;
  turnReductionPct: number;
  latencyReductionPct: number;
  regressionReductionPct: number;
  summaryText: string;
}

export interface TaskItem {
  id: string;
  title: string;
  status: 'Active' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  tags: string[];
  updatedAt?: number;
}

export interface MockApiOptions {
  networkLatencyMs?: number;
  shouldFail?: boolean;
  failureMessage?: string;
}
