// Everything that ships code to agents and users, as text to extract blocks from.
//
//   what-devtools-mcp   every resource and the prompt, from src/resources.js
//   create-what         CLAUDE.md and AGENTS.md of every template, scaffolded
//                       into a temporary directory (no install)
//   files               the shipped skills, every package README, the root
//                       README, docs/*.md, llms.txt, llms-full.txt and the
//                       docs-site pages
//   catalogue           ERROR_CODES' codeExample fields
//
// The renderings generated from the catalogue (docs/ERRORS.md, the site's
// errors page, diagnostics.json and the error-codes resource) are skipped:
// check:error-docs keeps them equal to the catalogue, which is checked here.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const GENERATED_FROM_CATALOGUE = [
  'docs/ERRORS.md',
  'docs-site/docs/reference/errors.html',
  'packages/what/diagnostics.json',
  'what-devtools-mcp what://docs/error-codes',
];

const SCAFFOLD_TEMPLATES = ['spa', 'fullstack', 'islands'];

function walk(dir, accept, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, accept, out);
    else if (accept(entry)) out.push(full);
  }
  return out;
}

/** The repository files whose code blocks are checked, as repo-relative paths. */
export function documentFiles(repo) {
  const rel = (f) => relative(repo, f);
  const files = [
    ...walk(join(repo, 'packages/what/skills'), (e) => e === 'SKILL.md').map(rel),
    ...readdirSync(join(repo, 'packages')).map((p) => `packages/${p}/README.md`).filter((f) => isFile(join(repo, f))),
    'README.md',
    ...readdirSync(join(repo, 'docs')).filter((e) => e.endsWith('.md')).map((e) => `docs/${e}`),
    'docs-site/llms.txt',
    'docs-site/llms-full.txt',
    ...walk(join(repo, 'docs-site'), (e) => e.endsWith('.html')).map(rel),
  ];
  return [...new Set(files)].filter((f) => !GENERATED_FROM_CATALOGUE.includes(f)).sort();
}

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

/** what-devtools-mcp's resources and prompt, as Markdown sources. */
export async function mcpSources(repo) {
  const { RESOURCES, PROMPTS } = await import(pathToFileURL(join(repo, 'packages/devtools-mcp/src/resources.js')).href);
  const out = [];
  for (const r of RESOURCES) {
    const label = `what-devtools-mcp ${r.uri}`;
    if (GENERATED_FROM_CATALOGUE.includes(label)) continue;
    out.push({ label, file: 'packages/devtools-mcp/src/resources.js', kind: 'markdown', text: r.text() });
  }
  for (const p of PROMPTS) {
    out.push({ label: `what-devtools-mcp prompt ${p.name}`, file: 'packages/devtools-mcp/src/resources.js', kind: 'markdown', text: p.text({ toolCount: 0 }) });
  }
  return out;
}

/** CLAUDE.md and AGENTS.md as create-what writes them for every template. */
export function scaffoldSources(repo) {
  const dir = mkdtempSync(join(tmpdir(), 'what-snippets-scaffold-'));
  const out = [];
  try {
    for (const template of SCAFFOLD_TEMPLATES) {
      const run = spawnSync(process.execPath, [join(repo, 'packages/create-what/index.js'), template, '--yes', `--template=${template}`], {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (run.status !== 0) throw new Error(`create-what --template=${template} failed: ${run.stderr || run.error}`);
      for (const name of ['CLAUDE.md', 'AGENTS.md']) {
        out.push({
          label: `create-what --template=${template} ${name}`,
          file: 'packages/create-what/agent-instructions.js',
          kind: 'markdown',
          text: readFileSync(join(dir, template, name), 'utf8'),
        });
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

/** The repository documents, read as Markdown or HTML. */
export function fileSources(repo) {
  return documentFiles(repo).map((file) => ({
    label: file,
    file,
    kind: file.endsWith('.html') ? 'html' : 'markdown',
    text: readFileSync(join(repo, file), 'utf8'),
  }));
}

/** ERROR_CODES entries that carry a codeExample, with the line of their code in errors.js. */
export async function catalogueSources(repo) {
  const file = 'packages/core/src/errors.js';
  const text = readFileSync(join(repo, file), 'utf8');
  const { ERROR_CODES } = await import(pathToFileURL(join(repo, file)).href);
  const detects = new Map(JSON.parse(readFileSync(join(repo, 'packages/what/diagnostics.json'), 'utf8')).codes.map((c) => [c.code, c.detects]));
  return Object.values(ERROR_CODES).filter((def) => def.codeExample).map((def) => {
    const at = text.indexOf(`code: '${def.code}'`);
    return {
      label: file,
      file,
      kind: 'catalogue',
      code: def.code,
      detects: detects.get(def.code) || [],
      example: def.codeExample,
      line: at === -1 ? 1 : text.slice(0, at).split('\n').length,
    };
  });
}
