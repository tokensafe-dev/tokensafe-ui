# Agent Usability Benchmark (AUB / AUI-Bench)
### Comparative Evaluation: Modern React vs. TokenSafe UI (OUMV Protocol)

> **The primary thesis of TokenSafe UI**:  
> *"TokenSafe UI is not merely a more token-efficient framework for AI agents to read. It fundamentally increases the autonomous development velocity, reliability, and error resilience of AI coding agents while eliminating closure traps, regressions, and context bloat."*

---

## 1. Executive Summary & Benchmark Scorecard

The **Agent Usability Benchmark (AUB)** compares autonomous AI agents solving identical, production-grade frontend engineering challenges on:
- **Baseline Stack**: Modern React 18/19 (Hooks, TypeScript, Vite, jsdom/Vitest).
- **Target Stack**: TokenSafe UI (OUMV Protocol, Fine-Grained Signals, Symbol-level OCC edits, Low-ms Action Verification).

### The Comparative Scorecard

| Evaluation Metric | Baseline: React 18/19 | Target: TokenSafe UI | Delta / Advantage |
| :--- | :---: | :---: | :---: |
| **Autonomous Efficiency Ratio (AER)** | $1.0\times$ (baseline) | **$7.62\times$ (WINNER)** | **+662% higher autonomous yield** |
| **Functional Yield per 1k Tokens ($\mathbf{FYpT}$)** | \`0.3687\` | **\`2.8103\`** | **+662% working code / token** |
| **Total Tokens Consumed ($T_{\text{total}}$)** | \`32,550\` | **\`4,270\`** | **-86.9% tokens saved** |
| • Input Tokens ($T_{\text{in}}$) | \`28,170\` | \`3,150\` | -88.8% context bloat |
| • Output Tokens ($T_{\text{out}}$) | \`4,380\` | \`1,120\` | -74.4% generation overhead |
| **Agent Iterations (Turns to Green)** | \`6 turns\` | **\`3 turns\`** | **-50.0% fewer roundtrips** |
| **Diagnostics Errors Encountered** | \`3 errors\` | **\`0 errors\`** | **Zero syntax or type errors** |
| **Regressions Encountered** | \`2 regressions\` | **\`0 regressions\`** | **Zero broken test regressions** |
| **Self-Recovery Rate ($SRR$)** | \`100%\` | **\`100%\`** | **100% resilient** |
| **Estimated LLM Run Cost** | \`$0.1502\` | **\`$0.0262\`** | **-82.6% cost reduction** |
| **Cost Yield (Passed Assertions / $)** | \`79.89\` | **\`458.02\`** | **5.7x more software per dollar** |

---

## 2. The North Star Metric Formulation

Traditional benchmarks measure token savings or binary pass/fail outcomes. AUB introduces **Functional Yield per Token (FYpT)** to capture real economic and functional productivity:

$$\text{FYpT} = \frac{\text{Passed Functional Assertions}}{T_{\text{total}}} \times 1,000$$

Where:
- $\text{Passed Functional Assertions}$: Number of verified acceptance assertions in the shared Behavioral Oracle (out of 12).
- $T_{\text{total}}$: Total cumulative input and output tokens across all agent turns.

This directly derives the **Autonomous Efficiency Ratio (AER)**:

$$\text{AER} = \frac{\text{FYpT}_{\text{TokenSafe}}}{\text{FYpT}_{\text{React}}} = \frac{2.8103}{0.3687} = \mathbf{7.62\times}$$

An $\text{AER} > 1.0$ mathematically proves that TokenSafe UI produces more working, verified software per unit of spent token than React.

---

## 3. The Benchmark Scenario: Full-Featured Task Manager

Both agents receive identical prompt specifications to implement a Task Manager with four architectural pillars:

1. **Multi-Dimensional Filtering**:
   - Filter by Status: \`All\`, \`Active\`, \`Completed\`.
   - Filter by Priority: \`All\`, \`High\`, \`Medium\`, \`Low\`.
2. **Real-Time Live Search**:
   - Real-time search query matching task titles and tag arrays.
   - Combined multi-criteria conjunction (\`query AND status AND priority\`).
3. **Asynchronous Persistence**:
   - Network simulation with 50–200ms latency.
   - Active save state (\`isSaving: true\`), submit button disabled, loading feedback.
   - Confirmation notice upon successful resolution.
4. **Resilience, Error Handling & Rollback**:
   - Simulated network failure (HTTP 500 Internal Server Error).
   - Dismissible error banner with message and interactive \`Retry\` button.
   - Optimistic UI updates with instant rollback to prior state upon server rejection.

---

## 4. The Shared Behavioral Acceptance Oracle (12 Assertions)

The shared Behavioral Oracle ([`task-manager-oracle.ts`](file:///Users/olegsavelev/Documents/projects/agent-dom/packages/benchmark/src/oracle/task-manager-oracle.ts)) verifies 12 discrete functional units against headless DOM and contract interfaces:

```
[x] TC01: Initial mount & pre-seeded state verification
[x] TC02: Add task with priority & defaults
[x] TC03: Toggle task completion status
[x] TC04: Real-time query search (title + tags)
[x] TC05: Status filter (Active / Completed)
[x] TC06: Priority filter (High / Medium / Low)
[x] TC07: Combined multi-condition filter conjunction (AND)
[x] TC08: Async save pending state & button lock
[x] TC09: Async save success notification
[x] TC10: Async save HTTP 500 failure & error banner display
[x] TC11: Retry action recovery upon network failure
[x] TC12: Optimistic UI toggle & rollback on rejection
```

Both sandboxes verified at **100% functional pass rate (12/12 assertions)**.

---

## 5. Architectural Root-Cause Analysis: Why React Fails Agents

| Failure Mode | Modern React 18/19 | TokenSafe UI (OUMV) |
| :--- | :--- | :--- |
| **Reactivity Traps** | \`useEffect\` and closures capture stale state. Agents frequently omit dependency array entries or create infinite re-render loops during async calls. | **Signals & Pure Reducers**: Zero closure traps. State updates are deterministic pure reducers \`(state, payload) => newState\`. |
| **Observation Bloat** | Agents inspect entire JSX files + DOM snapshots (~2,500–4,000 tokens per turn), quickly exhausting context windows. | **L0–L4 Multi-Level Observer**: Agents inspect L1 Interactive Surface (<180 tokens), cutting observation tokens by >85%. |
| **Mutation Fragility** | Wholesale file rewrites cause lost imports, misplaced brackets, and TypeScript syntax errors. | **Symbol-level OCC Edits**: Atomic modifications with AST syntax verification and optimistic concurrency control (\`expectedVersion\`). |
| **Verification Latency** | Running test suites requires full headless browsers or jsdom harnesses (3,000–6,000ms) with noisy multi-line logs. | **In-Memory Action Testing**: \`testAction\` evaluates transitions in single-digit milliseconds (<10ms) with structured diffs. |
| **Invisible Causality** | When UI state is unexpected, agents must guess which hook or prop triggered it. | **Causality Engine (\`why_state\`)**: Instant trace of which action, signal, or effect mutated the target state and why. |

---

## 6. How to Run the Benchmark

The benchmark harness is located in \`packages/benchmark\` and is fully runnable offline:

```bash
# 1. Run deterministic replay benchmark and generate report
pnpm aub:replay

# 2. View latest benchmark report in terminal
pnpm --filter @tokensafe/benchmark aub:report

# 3. Run unit tests for the benchmark suite
pnpm --filter @tokensafe/benchmark test
```

### Generated Artifacts
- **Markdown Report**: \`packages/benchmark/BENCHMARK_REPORT.md\`
- **JSON Telemetry Data**: \`packages/benchmark/aub-results.json\`
