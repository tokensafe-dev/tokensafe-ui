#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

// Setup headless DOM environment if running directly in node
if (typeof document === 'undefined') {
  const { Window } = await import('happy-dom');
  const win = new Window();
  (globalThis as any).window = win;
  (globalThis as any).document = win.document;
  (globalThis as any).HTMLElement = win.HTMLElement;
  (globalThis as any).HTMLButtonElement = win.HTMLButtonElement;
  (globalThis as any).HTMLInputElement = win.HTMLInputElement;
  (globalThis as any).customElements = win.customElements;
}

import { BenchmarkHarness } from '../runner/harness.js';
import { BenchmarkReporter } from '../runner/reporter.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'replay';

  console.log(`\n🚀 [AUB] Agent Usability Benchmark v0.1.0`);
  console.log(`Command: ${command}\n`);

  const harness = new BenchmarkHarness({ scenario: 'task-manager' });

  if (command === 'replay' || command === 'run') {
    console.log(`⏳ Evaluating 12-Assertion Behavioral Oracle against sandboxes...`);
    const groundTruth = await harness.evaluateGroundTruth();
    console.log(`   ✓ React Sandbox Oracle: ${groundTruth.reactReport.passedCount}/12 assertions passed`);
    console.log(`   ✓ TokenSafe UI Sandbox Oracle: ${groundTruth.tokenSafeReport.passedCount}/12 assertions passed\n`);

    const isOptimized = args.includes('--optimized');
    console.log(`⏳ Simulating Agent Iterations & Telemetry Collection (${isOptimized ? 'Super-Optimized 1-turn' : 'Golden Trace'})...`);
    const summary = await harness.runReplayBenchmark({ optimized: isOptimized });

    const terminalReport = BenchmarkReporter.formatTerminal(summary);
    console.log(terminalReport);

    // Save Markdown report and JSON telemetry
    const mdReport = BenchmarkReporter.formatMarkdown(summary);
    const reportPath = path.resolve(process.cwd(), 'BENCHMARK_REPORT.md');
    const jsonPath = path.resolve(process.cwd(), 'aub-results.json');

    fs.writeFileSync(reportPath, mdReport, 'utf-8');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf-8');

    console.log(`📁 Artifacts generated:`);
    console.log(`   • ${reportPath}`);
    console.log(`   • ${jsonPath}\n`);
  } else if (command === 'report') {
    const jsonPath = path.resolve(process.cwd(), 'aub-results.json');
    if (!fs.existsSync(jsonPath)) {
      console.error(`❌ No benchmark results found at ${jsonPath}. Run 'aub replay' first.`);
      process.exit(1);
    }
    const summary = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    console.log(BenchmarkReporter.formatTerminal(summary));
  } else {
    console.error(`Unknown command: ${command}. Available: replay, run, report`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ Benchmark execution failed:', err);
  process.exit(1);
});
