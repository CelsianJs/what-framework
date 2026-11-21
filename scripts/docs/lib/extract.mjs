// Code blocks out of Markdown and HTML, with the snippet marker that precedes
// each one and the language it is checked as.
//
// A Markdown fence names its language. A docs-site page does not: every block
// is a bare <pre><code>, so the language is read from the content, and only a
// block that parses as JavaScript or reads like JavaScript is checked as code.

import { parse } from '@babel/parser';

const JS_LANGS = new Map([
  ['js', 'js'], ['javascript', 'js'], ['mjs', 'js'], ['cjs', 'js'],
  ['jsx', 'jsx'],
  ['ts', 'ts'], ['typescript', 'ts'], ['mts', 'ts'], ['cts', 'ts'],
  ['tsx', 'tsx'],
]);

/** The checked language of a fence info string ('js', 'jsx', 'ts', 'tsx'), or null. */
export function codeLanguage(info) {
  const word = String(info || '').trim().split(/[\s{]/)[0].toLowerCase();
  return JS_LANGS.get(word) || null;
}

const MARKER_RE = /^<!--\s*snippet:([\s\S]*?)-->$/;
const MARKER_BODY_RE = /^\s*bad\s+(?:(lint|compile|run)=(ERR_[A-Z0-9_]+)|(import))\s*$/;

/**
 * Parse the text of a `<!-- snippet: ... -->` comment.
 * @returns {{ channel: 'lint' | 'compile' | 'run' | 'import', code: string | null } | { error: string }}
 */
export function parseMarker(comment) {
  const m = MARKER_RE.exec(comment.trim());
  if (!m) return { error: `not a snippet marker: ${comment.trim()}` };
  const body = MARKER_BODY_RE.exec(m[1]);
  if (!body) {
    return { error: `unrecognized snippet marker "${comment.trim()}": the forms are <!-- snippet: bad lint=ERR_X -->, bad compile=ERR_X, bad run=ERR_X and bad import` };
  }
  return body[3] ? { channel: 'import', code: null } : { channel: body[1], code: body[2] };
}

/**
 * Fenced code blocks of a Markdown text.
 * @returns {{ line: number, info: string, lang: string | null, code: string, marker: object | null }[]}
 *   `line` is the 1-based line of the block's first code line.
 * Markers that precede no fence are returned as blocks with `stray: true`.
 */
export function extractMarkdownBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let pendingMarker = null; // { line, parsed }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (open && !(open[2][0] === '`' && open[3].includes('`'))) {
      const [, indent, fence, info] = open;
      const body = [];
      let j = i + 1;
      const close = new RegExp(`^\\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
      for (; j < lines.length && !close.test(lines[j]); j++) {
        body.push(lines[j].startsWith(indent) ? lines[j].slice(indent.length) : lines[j].replace(/^\s+/, ''));
      }
      blocks.push({
        line: i + 2,
        info: info.trim(),
        lang: codeLanguage(info),
        code: body.join('\n'),
        marker: pendingMarker ? pendingMarker.parsed : null,
      });
      pendingMarker = null;
      i = j;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--') && /^<!--\s*snippet:/.test(trimmed)) {
      if (pendingMarker) blocks.push({ line: pendingMarker.line, stray: true, marker: pendingMarker.parsed });
      pendingMarker = { line: i + 1, parsed: parseMarker(trimmed) };
      continue;
    }
    if (trimmed && pendingMarker) {
      blocks.push({ line: pendingMarker.line, stray: true, marker: pendingMarker.parsed });
      pendingMarker = null;
    }
  }
  if (pendingMarker) blocks.push({ line: pendingMarker.line, stray: true, marker: pendingMarker.parsed });
  return blocks;
}

const ENTITIES = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };

/** Decode the HTML entities a highlighted code block uses. */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (name[0] === '#') {
      const cp = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * `<pre>` blocks of an HTML page (with or without a `<code>` inside), with
 * highlighting markup stripped and entities decoded, and the language
 * inferred from the content.
 * @returns {{ line: number, lang: string | null, code: string, marker: object | null }[]}
 */
export function extractHtmlBlocks(html) {
  const blocks = [];
  const used = new Set();
  const re = /<pre\b[^>]*>(?:\s*<code\b[^>]*>)?([\s\S]*?)(?:<\/code>\s*)?<\/pre>/g;
  for (const m of html.matchAll(re)) {
    const code = decodeEntities(m[1].replace(/<[^>]+>/g, ''));
    // The marker is the comment that ends right before <pre>, if it is one.
    const before = html.slice(0, m.index).trimEnd();
    const start = before.lastIndexOf('<!--');
    let marker = null;
    if (start !== -1 && before.endsWith('-->') && before.indexOf('-->', start) === before.length - 3 && /^<!--\s*snippet:/.test(before.slice(start))) {
      marker = parseMarker(before.slice(start));
      used.add(start);
    }
    const leading = m[1].match(/^\s*\n/);
    blocks.push({ line: lineAt(html, m.index) + (leading ? 1 : 0), lang: inferLanguage(code), code: leading ? code.replace(/^\s*\n/, '') : code, marker });
  }
  for (const m of html.matchAll(/<!--\s*snippet:[\s\S]*?-->/g)) {
    if (!used.has(m.index)) blocks.push({ line: lineAt(html, m.index), stray: true, marker: parseMarker(m[0]) });
  }
  return blocks;
}

const SHELL_RE = /^(?:\$\s|#(?!!)|(?:npm|npx|pnpm|yarn|bun|bunx|deno|cd|git|curl|mkdir|vercel|wrangler|brew)\s|node\s+[-\w./]+(?:\s|$)(?!.*[=(]))/;
const MARKUP_RE = /^<(?:!doctype|html|head|body|meta|link|script|style)\b/i;
// A file tree: box-drawing characters, or a line that is only a directory name.
const TREE_RE = /[├└│]|^\s*[\w.@()[\]-]+\/\s*(?:#.*)?$/m;
const JS_LINE_RE = /^\s*(?:import\s+[\w{*'"]|export\s+(?:default|const|let|var|function|async|class|\{|\*)|(?:const|let|var)\s+[\w${[]|(?:async\s+)?function[\s*]|class\s+\w|return\b|await\s|\/\/|(?:if|for|while)\s*\(|try\s*\{|[\w$.]+\(.*\)\s*;?\s*(?:\/\/.*)?$)/m;

function parses(code, plugins) {
  try {
    parse(code, { sourceType: 'module', plugins, errorRecovery: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * The language of an unlabelled block: 'jsx', 'tsx' or 'ts' for code, null for
 * anything else (shell, markup, CSS, JSON, file trees, program output, an MCP
 * tool call and its answer).
 *
 * A block is code when it parses as JavaScript, or when it does not parse but
 * reads like JavaScript (a declaration, an import, an arrow, a JS comment, a
 * component tag or a JSX expression attribute), in which case the parse error
 * is reported rather than the block being passed over as prose.
 */
export function inferLanguage(code) {
  const first = code.split('\n').map((l) => l.trim()).find(Boolean) || '';
  if (!first || SHELL_RE.test(first) || MARKUP_RE.test(first) || TREE_RE.test(code)) return null;
  const uncommented = code.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').trim();
  if (/^[{[]\s*"(?:[^"\\]|\\.)*"\s*:/.test(uncommented)) return null;
  if (/^\s*what_[a-z_]+\s*\(/m.test(uncommented)) return null;
  if (parses(code, ['jsx'])) return 'jsx';
  if (parses(code, ['typescript', 'jsx'])) return 'tsx';
  if (parses(code, ['typescript'])) return 'ts';
  if (JS_LINE_RE.test(code) || code.includes('=>') || /<[A-Z][\w.]*[\s/>]/.test(code) || /\s[\w-]+=\{/.test(code)) return 'jsx';
  return null;
}
