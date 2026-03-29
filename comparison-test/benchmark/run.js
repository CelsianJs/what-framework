#!/usr/bin/env node
/**
 * Benchmark Runner — Cross-framework, cross-model comparative testing.
 *
 * Dispatches agents to build the same app concept in WhatFW, React, and Svelte,
 * then runs review agents to score each output.
 *
 * Usage:
 *   node comparison-test/benchmark/run.js                    # random prompt, all frameworks, claude-code opus
 *   node comparison-test/benchmark/run.js --prompt kanban-board
 *   node comparison-test/benchmark/run.js --prompt kanban-board --framework whatfw --model opus
 *   node comparison-test/benchmark/run.js --scoreboard       # show leaderboard
 *
 * Models:
 *   --model opus       → Claude Code with Opus 4.6
 *   --model sonnet     → Claude Code with Sonnet 4.6
 *   --model gpt5       → Codex with GPT-5.4
 *   --model deepseek   → OpenCode with DeepSeek V3
 *   --model kimi       → OpenCode with Kimi K2
 *
 * Frameworks:
 *   --framework whatfw   → What Framework
 *   --framework react    → React + Vite
 *   --framework svelte   → Svelte + Vite
 *   (default: all three)
 */

import { execSync, spawn } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { addPrompt, createRun, updateRun, getRun, getScoreboard, getNextRound } from './db.js';
import { prompts, getRandomPrompt, getPromptBySlug } from './prompts/bank.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPS_DIR = join(__dirname, 'apps');
const WHATFW_ROOT = join(__dirname, '..', '..');

// Load .env
try {
  const envFile = readFileSync(join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch {}

// --- Parse args ---
const args = process.argv.slice(2);
const getArg = (name) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

if (hasFlag('scoreboard')) {
  const board = getScoreboard();
  if (board.length === 0) {
    console.log('No reviewed runs yet. Run some benchmarks first.');
  } else {
    console.log('\n📊 SCOREBOARD\n');
    console.log('Framework  | Model          | Runs | Overall | Style | Perf  | Quality | Func  | Avg Tokens');
    console.log('-'.repeat(100));
    for (const row of board) {
      console.log(
        `${row.framework.padEnd(10)} | ${row.model.padEnd(14)} | ${String(row.runs).padStart(4)} | ` +
        `${String(row.avg_overall).padStart(7)} | ${String(row.avg_styling).padStart(5)} | ` +
        `${String(row.avg_performance).padStart(5)} | ${String(row.avg_code_quality).padStart(7)} | ` +
        `${String(row.avg_functionality).padStart(5)} | ${String(row.avg_tokens).padStart(10)}`
      );
    }
  }
  process.exit(0);
}

// --- Config ---
const promptSlug = getArg('prompt');
const frameworkArg = getArg('framework');
const modelArg = getArg('model') || 'opus';

const frameworks = frameworkArg ? [frameworkArg] : ['whatfw', 'react', 'svelte'];
const prompt = promptSlug ? getPromptBySlug(promptSlug) : getRandomPrompt();

if (!prompt) {
  console.error(`Prompt "${promptSlug}" not found. Available: ${prompts.map(p => p.slug).join(', ')}`);
  process.exit(1);
}

// Model → agent + model ID mapping
const MODEL_MAP = {
  opus:     { agent: 'claude-code', model: 'claude-opus-4.6',    cmd: 'claude' },
  sonnet:   { agent: 'claude-code', model: 'claude-sonnet-4.6',  cmd: 'claude' },
  gpt5:     { agent: 'codex',       model: 'gpt-5.4',            cmd: 'codex' },
  deepseek: { agent: 'opencode',    model: 'deepseek-v3',        cmd: 'opencode' },
  kimi:     { agent: 'opencode',    model: 'kimi-k2',            cmd: 'opencode' },
};

const modelConfig = MODEL_MAP[modelArg];
if (!modelConfig) {
  console.error(`Unknown model "${modelArg}". Available: ${Object.keys(MODEL_MAP).join(', ')}`);
  process.exit(1);
}

const round = getNextRound();

console.log(`\n🏁 Benchmark Round ${round}`);
console.log(`   Prompt: ${prompt.title} (${prompt.complexity})`);
console.log(`   Frameworks: ${frameworks.join(', ')}`);
console.log(`   Model: ${modelConfig.model} via ${modelConfig.agent}`);
console.log(`   Apps dir: ${APPS_DIR}\n`);

// --- Framework-specific build prompts ---

function getFrameworkPrompt(framework, appPrompt) {
  const base = `${appPrompt.description}\n\nRequirements:\n- Single-page app, no backend needed\n- Use Vite as the build tool\n- All state managed client-side\n- Clean, modern UI with CSS (no UI library)\n- Dark mode support\n- Responsive design\n- Put all code in the current directory`;

  // Read the framework-specific build context
  const contextDir = join(__dirname, 'prompts');
  function readContext(filename) {
    try { return readFileSync(join(contextDir, filename), 'utf8'); } catch { return ''; }
  }

  const iterateInstructions = `

CRITICAL WORKFLOW — You MUST verify your work:
1. Write all the code first
2. Run \`npm install\`
3. Start the dev server: \`npm run dev\` (in background)
4. VERIFY the app works using the tools described below
5. Fix any issues you find
6. Verify again until clean
7. Stop the dev server when done

Do NOT skip the verification step. The goal is a working, polished app — not just code that compiles.`;

  switch (framework) {
    case 'whatfw': {
      const context = readContext('whatfw-build-context.md');
      return `You are building a ${appPrompt.title} app using What Framework (WhatFW).

${context}

${base}
${iterateInstructions}

For verification, use the MCP DevTools (what_* tools) to:
- \`what_connection_status\` to confirm browser is connected
- \`what_diagnose\` to check for errors and issues
- \`what_page_map\` to verify page structure
- \`what_look\` on key components to verify layout and styling
- \`what_errors\` to find runtime errors
- \`what_lint\` to validate code quality
- \`what_signals\` to inspect state values

These MCP tools give you structured data about the running app — use them instead of screenshots.`;
    }

    case 'react': {
      const context = readContext('react-build-context.md');
      return `You are building a ${appPrompt.title} app using React.

${context}

${base}
${iterateInstructions}

For verification, use Playwright browser automation to:
- Navigate to the dev server URL
- Take screenshots to verify visual output
- Check the browser console for errors
- Test interactive features (click buttons, fill inputs, drag items)
- Verify responsive layout at different viewport sizes`;
    }

    case 'svelte': {
      const context = readContext('svelte-build-context.md');
      return `You are building a ${appPrompt.title} app using Svelte 5.

${context}

${base}
${iterateInstructions}

For verification, use Playwright browser automation to:
- Navigate to the dev server URL
- Take screenshots to verify visual output
- Check the browser console for errors
- Test interactive features (click buttons, fill inputs, drag items)
- Verify responsive layout at different viewport sizes`;
    }

    default:
      throw new Error(`Unknown framework: ${framework}`);
  }
}

// --- Run a single benchmark ---

async function runBenchmark(framework) {
  const dbPrompt = addPrompt(prompt);
  const runId = createRun({
    prompt_id: dbPrompt.id,
    framework,
    model: modelConfig.model,
    agent: modelConfig.agent,
    round,
  });

  const appDir = join(APPS_DIR, `round-${round}`, `${prompt.slug}-${framework}-${modelConfig.model}`);
  mkdirSync(appDir, { recursive: true });

  const buildPrompt = getFrameworkPrompt(framework, prompt);

  // Save prompt for reference
  writeFileSync(join(appDir, 'BENCHMARK_PROMPT.md'), buildPrompt);

  updateRun(runId, { status: 'running', app_path: appDir });

  console.log(`\n🔨 Building ${prompt.title} with ${framework} (${modelConfig.model})...`);
  console.log(`   Dir: ${appDir}`);

  const start = Date.now();

  try {
    // Save prompt to file — avoids shell escaping issues with long prompts
    const promptFile = join(appDir, 'BENCHMARK_PROMPT.txt');
    writeFileSync(promptFile, buildPrompt);

    // Build the shell command using the prompt file
    const shellCmd = buildShellCommand(framework, promptFile, appDir);
    console.log(`   Command: ${shellCmd.slice(0, 120)}...`);

    const result = execSync(shellCmd, {
      cwd: appDir,
      timeout: 600000, // 10 min max
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB
      shell: true,
    });

    const duration = Date.now() - start;

    // Try to extract token counts from output
    const tokenMatch = result.match(/total_tokens:\s*(\d+)/i) || result.match(/tokens?.*?(\d{3,})/i);
    const totalTokens = tokenMatch ? parseInt(tokenMatch[1]) : null;

    // Check if build works
    let buildSuccess = false;
    try {
      if (existsSync(join(appDir, 'package.json'))) {
        execSync('npm install 2>&1', { cwd: appDir, timeout: 60000 });
        execSync('npx vite build 2>&1', { cwd: appDir, timeout: 60000 });
        buildSuccess = true;
      }
    } catch (buildErr) {
      console.log(`   ⚠️  Build failed: ${buildErr.message?.slice(0, 100)}`);
    }

    updateRun(runId, {
      status: 'completed',
      duration_ms: duration,
      total_tokens: totalTokens,
      build_success: buildSuccess ? 1 : 0,
      completed_at: new Date().toISOString(),
    });

    console.log(`   ✅ Completed in ${(duration / 1000).toFixed(1)}s${totalTokens ? `, ~${totalTokens} tokens` : ''}`);
    console.log(`   Build: ${buildSuccess ? '✅' : '❌'}`);

    return runId;
  } catch (err) {
    const duration = Date.now() - start;
    updateRun(runId, {
      status: 'failed',
      error: err.message?.slice(0, 500),
      duration_ms: duration,
      completed_at: new Date().toISOString(),
    });
    console.log(`   ❌ Failed after ${(duration / 1000).toFixed(1)}s: ${err.message?.slice(0, 100)}`);
    return runId;
  }
}

function buildShellCommand(framework, promptFile, appDir) {
  const pf = JSON.stringify(promptFile); // safely quote the path

  switch (modelConfig.agent) {
    case 'claude-code': {
      const modelFlag = modelConfig.model.includes('sonnet') ? '--model sonnet' : '';
      return `claude -p "$(cat ${pf})" --output-format json --max-turns 50 --allowedTools Edit,Write,Bash,Read,Glob,Grep ${modelFlag}`;
    }

    case 'codex':
      return `codex --quiet --full-auto "$(cat ${pf})"`;

    case 'opencode': {
      const orModel = modelConfig.model === 'kimi-k2' ? 'moonshotai/kimi-k2' : 'deepseek/deepseek-chat';
      return `opencode chat --message "$(cat ${pf})" --provider openrouter --model ${orModel}`;
    }

    default:
      throw new Error(`Unknown agent: ${modelConfig.agent}`);
  }
}

// --- Main ---

const runIds = [];
for (const fw of frameworks) {
  const id = await runBenchmark(fw);
  runIds.push(id);
}

console.log(`\n${'='.repeat(60)}`);
console.log(`📊 Round ${round} Complete`);
console.log(`   Runs: ${runIds.join(', ')}`);
console.log(`   View results: node comparison-test/benchmark/run.js --scoreboard`);
console.log(`   Apps saved in: ${join(APPS_DIR, `round-${round}`)}`);
