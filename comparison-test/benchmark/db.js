/**
 * Benchmark Results Database (SQLite)
 *
 * Stores: prompts, runs, scores, and per-framework results.
 * Each "run" = one prompt × one framework × one model.
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, 'results', 'benchmark.db');

// Ensure results dir exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// --- Schema ---

db.exec(`
  CREATE TABLE IF NOT EXISTS prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,           -- e.g. "weather-dashboard"
    title TEXT NOT NULL,                 -- "Weather Dashboard"
    description TEXT NOT NULL,           -- Full app description
    complexity TEXT NOT NULL DEFAULT 'medium',  -- simple, medium, complex
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt_id INTEGER NOT NULL REFERENCES prompts(id),
    framework TEXT NOT NULL,             -- "whatfw", "react", "svelte"
    model TEXT NOT NULL,                 -- "claude-opus-4.6", "claude-sonnet-4.6", "gpt-5.4", "deepseek-v3", "kimi-k2"
    agent TEXT NOT NULL,                 -- "claude-code", "codex", "opencode"
    round INTEGER NOT NULL DEFAULT 1,   -- iteration round number

    -- Token metrics
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    duration_ms INTEGER,

    -- App output
    app_path TEXT,                       -- path to generated app
    app_port INTEGER,                    -- dev server port (if running)
    build_success INTEGER DEFAULT 0,     -- 1 = builds, 0 = fails
    dev_server_works INTEGER DEFAULT 0,  -- 1 = serves, 0 = fails

    -- Review scores (0-10 each, set by review agent)
    score_styling REAL,
    score_performance REAL,
    score_lighthouse REAL,
    score_code_quality REAL,
    score_functionality REAL,
    score_overall REAL,

    -- Review notes
    review_notes TEXT,
    review_agent TEXT,                   -- which model reviewed

    status TEXT DEFAULT 'pending',       -- pending, running, completed, failed, reviewed
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_runs_prompt ON runs(prompt_id);
  CREATE INDEX IF NOT EXISTS idx_runs_framework ON runs(framework);
  CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model);
  CREATE INDEX IF NOT EXISTS idx_runs_round ON runs(round);
`);

// --- API ---

export function addPrompt({ slug, title, description, complexity = 'medium' }) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO prompts (slug, title, description, complexity)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(slug, title, description, complexity);
  return db.prepare('SELECT * FROM prompts WHERE slug = ?').get(slug);
}

export function getPrompt(slug) {
  return db.prepare('SELECT * FROM prompts WHERE slug = ?').get(slug);
}

export function getAllPrompts() {
  return db.prepare('SELECT * FROM prompts ORDER BY created_at DESC').all();
}

export function createRun({ prompt_id, framework, model, agent, round = 1 }) {
  const stmt = db.prepare(`
    INSERT INTO runs (prompt_id, framework, model, agent, round, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);
  const result = stmt.run(prompt_id, framework, model, agent, round);
  return result.lastInsertRowid;
}

export function updateRun(id, updates) {
  const allowed = [
    'input_tokens', 'output_tokens', 'total_tokens', 'duration_ms',
    'app_path', 'app_port', 'build_success', 'dev_server_works',
    'score_styling', 'score_performance', 'score_lighthouse',
    'score_code_quality', 'score_functionality', 'score_overall',
    'review_notes', 'review_agent', 'status', 'error', 'completed_at',
  ];
  const sets = [];
  const values = [];
  for (const [key, val] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      sets.push(`${key} = ?`);
      values.push(val);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getRun(id) {
  return db.prepare(`
    SELECT r.*, p.slug, p.title, p.description, p.complexity
    FROM runs r JOIN prompts p ON r.prompt_id = p.id
    WHERE r.id = ?
  `).get(id);
}

export function getRunsForPrompt(promptSlug) {
  return db.prepare(`
    SELECT r.*, p.slug, p.title
    FROM runs r JOIN prompts p ON r.prompt_id = p.id
    WHERE p.slug = ?
    ORDER BY r.round, r.framework, r.model
  `).all(promptSlug);
}

export function getLatestRuns(limit = 50) {
  return db.prepare(`
    SELECT r.*, p.slug, p.title
    FROM runs r JOIN prompts p ON r.prompt_id = p.id
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function getScoreboard() {
  return db.prepare(`
    SELECT
      framework,
      model,
      COUNT(*) as runs,
      ROUND(AVG(score_overall), 1) as avg_overall,
      ROUND(AVG(score_styling), 1) as avg_styling,
      ROUND(AVG(score_performance), 1) as avg_performance,
      ROUND(AVG(score_code_quality), 1) as avg_code_quality,
      ROUND(AVG(score_functionality), 1) as avg_functionality,
      ROUND(AVG(total_tokens), 0) as avg_tokens,
      ROUND(AVG(duration_ms), 0) as avg_duration_ms
    FROM runs
    WHERE status = 'reviewed' AND score_overall IS NOT NULL
    GROUP BY framework, model
    ORDER BY avg_overall DESC
  `).all();
}

export function getNextRound() {
  const row = db.prepare('SELECT MAX(round) as max_round FROM runs').get();
  return (row?.max_round || 0) + 1;
}

export { db };
