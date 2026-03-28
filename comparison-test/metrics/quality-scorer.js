/**
 * Quality scorer — evaluates AI-generated app code against a rubric.
 * Scores: builds (0/1), runs (0/1), correct (0-5), idiomatic (0-3), performance (0-3), errorRecovery (0-3)
 * Total: 0-16
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Check if the project builds successfully.
 * @returns {number} 0 or 1
 */
export function scoreBuild(projectDir) {
  try {
    execSync('npm run build', { cwd: projectDir, stdio: 'pipe', timeout: 60000 });
    return 1;
  } catch {
    return 0;
  }
}

/**
 * Check if the dev server starts successfully.
 * Starts the server, waits for it to respond, then kills it.
 * @returns {number} 0 or 1
 */
export async function scoreRuns(projectDir) {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      proc.kill();
      resolve(0); // Timed out
    }, 15000);

    const proc = spawn('npm', ['run', 'dev'], {
      cwd: projectDir,
      stdio: 'pipe',
      env: { ...process.env, PORT: '4999' },
    });

    let output = '';
    proc.stdout.on('data', (d) => { output += d.toString(); });
    proc.stderr.on('data', (d) => { output += d.toString(); });

    // Check for common "server ready" signals
    const checkReady = () => {
      if (output.match(/ready|started|listening|localhost|http:\/\//i)) {
        clearTimeout(timeout);
        proc.kill();
        resolve(1);
      }
    };

    proc.stdout.on('data', checkReady);
    proc.stderr.on('data', checkReady);

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      resolve(code === 0 || output.match(/ready|started/i) ? 1 : 0);
    });
  });
}

/**
 * Run Playwright acceptance tests from the scenario.
 * @returns {number} 0-5 based on percentage of tests passing
 */
export async function scoreCorrectness(projectDir, scenarioTests) {
  // Write the test file
  const testPath = join(projectDir, 'acceptance.test.js');
  const testContent = `
    import { test, expect } from '@playwright/test';

    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:4999');
      await page.waitForLoadState('networkidle');
    });

    ${scenarioTests}
  `;

  try {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(testPath, testContent);

    const result = execSync('npx playwright test acceptance.test.js --reporter=json', {
      cwd: projectDir,
      stdio: 'pipe',
      timeout: 30000,
    });

    const json = JSON.parse(result.toString());
    const passed = json.stats?.expected || 0;
    const total = (json.stats?.expected || 0) + (json.stats?.unexpected || 0);

    if (total === 0) return 0;
    return Math.round((passed / total) * 5);
  } catch {
    return 0;
  }
}

/**
 * Score code quality / framework idiom adherence.
 * Uses static analysis heuristics.
 * @returns {number} 0-3
 */
export function scoreIdiomatic(projectDir, framework) {
  let score = 0;

  const srcFiles = findSourceFiles(projectDir);
  if (srcFiles.length === 0) return 0;

  const allCode = srcFiles.map(f => readFileSync(f, 'utf-8')).join('\n');

  if (framework === 'whatfw') {
    // Check for WhatFW idioms
    if (allCode.includes('signal(')) score++; // Uses signals
    if (allCode.includes('effect(') || allCode.includes('computed(')) score++; // Uses reactive primitives
    if (!allCode.includes('useState') && !allCode.includes('useEffect')) score++; // Doesn't mix React patterns
  } else if (framework === 'react') {
    // Check for React idioms
    if (allCode.includes('useState')) score++; // Uses hooks
    if (allCode.includes('useEffect') || allCode.includes('useMemo')) score++; // Uses lifecycle hooks
    if (!allCode.includes('signal(')) score++; // Doesn't mix non-React patterns
  }

  return score;
}

/**
 * Score generated app performance.
 * Measures: source size, dependency count, estimated complexity.
 * @returns {number} 0-3
 */
export function scorePerformance(projectDir) {
  let score = 0;

  const srcFiles = findSourceFiles(projectDir);
  const totalSize = srcFiles.reduce((sum, f) => sum + statSync(f).size, 0);

  // Source size score (smaller is better for simple apps)
  if (totalSize < 10000) score++; // Under 10KB of source
  else if (totalSize < 30000) score += 0.5;

  // Component decomposition (more files = better structure, to a point)
  const componentFiles = srcFiles.filter(f => f.match(/\.(jsx|tsx|vue|svelte)$/));
  if (componentFiles.length >= 2) score++;
  if (componentFiles.length >= 4) score += 0.5;

  // No unnecessary dependencies
  try {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));
    const depCount = Object.keys(pkg.dependencies || {}).length;
    if (depCount <= 3) score += 0.5; // Minimal deps
  } catch {}

  return Math.min(3, Math.round(score));
}

/**
 * Score error recovery: how many iterations did the agent need?
 * Fewer iterations = better error recovery.
 * @returns {number} 0-3
 */
export function scoreErrorRecovery(iterations, maxIterations = 10) {
  if (iterations <= 1) return 3; // Got it right first try
  if (iterations <= 3) return 2; // Quick recovery
  if (iterations <= 5) return 1; // Moderate recovery
  return 0; // Too many iterations
}

/**
 * Run full scoring rubric.
 */
export async function scoreAll(projectDir, framework, scenarioTests, iterations) {
  const builds = scoreBuild(projectDir);
  const runs = builds ? await scoreRuns(projectDir) : 0;
  const correct = runs ? await scoreCorrectness(projectDir, scenarioTests) : 0;
  const idiomatic = scoreIdiomatic(projectDir, framework);
  const performance = scorePerformance(projectDir);
  const errorRecovery = scoreErrorRecovery(iterations);

  return {
    builds,
    runs,
    correct,
    idiomatic,
    performance,
    errorRecovery,
    total: builds + runs + correct + idiomatic + performance + errorRecovery,
  };
}

// Helper: find .js/.jsx/.ts/.tsx source files
function findSourceFiles(dir, files = []) {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      findSourceFiles(path, files);
    } else if (entry.match(/\.(js|jsx|ts|tsx|vue|svelte)$/)) {
      files.push(path);
    }
  }

  return files;
}
