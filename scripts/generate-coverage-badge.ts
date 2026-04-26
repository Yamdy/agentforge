/**
 * Coverage Badge Generator
 *
 * Generates an SVG badge showing test coverage percentage.
 * Run with: npx tsx scripts/generate-coverage-badge.ts
 */

import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

interface CoverageResult {
  lines: number;
  statements: number;
  branches: number;
  functions: number;
}

function parseCoverage(output: string): CoverageResult | null {
  // Look for the "All files" line
  const match = output.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
  if (!match) return null;

  return {
    statements: parseFloat(match[1]),
    branches: parseFloat(match[2]),
    functions: parseFloat(match[3]),
    lines: parseFloat(match[4]),
  };
}

function generateBadgeSVG(coverage: number): string {
  // Determine color based on coverage
  let color: string;
  if (coverage >= 80) {
    color = '#4c1'; // green
  } else if (coverage >= 60) {
    color = '#97CA00'; // yellow-green
  } else if (coverage >= 40) {
    color = '#dfb317'; // yellow
  } else {
    color = '#e05d44'; // red
  }

  const label = 'coverage';
  const value = `${coverage.toFixed(1)}%`;
  
  // Calculate widths
  const labelWidth = label.length * 7 + 10;
  const valueWidth = value.length * 7 + 10;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="${totalWidth}" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}

async function main() {
  console.log('Generating coverage badge...\n');

  try {
    // Run coverage
    const output = execSync('npx vitest run --coverage', {
      encoding: 'utf-8',
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const coverage = parseCoverage(output);
    if (!coverage) {
      console.error('Could not parse coverage output');
      process.exit(1);
    }

    console.log('Coverage Results:');
    console.log(`  Statements: ${coverage.statements}%`);
    console.log(`  Branches:   ${coverage.branches}%`);
    console.log(`  Functions:  ${coverage.functions}%`);
    console.log(`  Lines:      ${coverage.lines}%`);

    // Generate badge using lines coverage
    const badge = generateBadgeSVG(coverage.lines);
    const badgePath = join(process.cwd(), 'coverage-badge.svg');
    writeFileSync(badgePath, badge);

    console.log(`\nBadge generated: ${badgePath}`);
    console.log(`Coverage: ${coverage.lines}%`);

  } catch (error) {
    console.error('Error generating badge:', error);
    process.exit(1);
  }
}

main();
