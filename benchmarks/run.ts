/**
 * AgentForge Benchmark Runner
 *
 * Run with: npx tsx benchmarks/run.ts
 */

import { BenchmarkRunner, standardScenarios } from './benchmark-runner.js';

async function main() {
  console.log('AgentForge Benchmark Suite');
  console.log('========================\n');

  const runner = new BenchmarkRunner();

  // Run all standard scenarios
  const scenarios = [
    standardScenarios.eventStreamCreation(),
    standardScenarios.zodValidation(),
    standardScenarios.securityCheck(),
    standardScenarios.rateLimitCheck(),
    standardScenarios.quotaCheck(),
  ];

  for (const scenario of scenarios) {
    await runner.runScenario(scenario, 'AgentForge');
  }

  // Print comparison table
  runner.printComparisonTable();

  // Save results
  const results = runner.getResults();
  console.log(`\nCompleted ${results.length} benchmarks.`);
  console.log('Results saved to benchmarks/results.json');
}

main().catch(console.error);
