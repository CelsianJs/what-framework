// What DevTools MCP - Tool changes
//
// The tools what-devtools-mcp 0.14 registered that 0.15 does not, what to call
// instead, and the tools 0.15 added. This is the one list:
// scripts/generate-import-changes.mjs renders it into docs/UPGRADING.md and
// docs/MCP-DEVTOOLS.md, and scripts/release/test/upgrading-docs.test.mjs checks
// it against the tools the server registers, so the count, the removed names
// and every replacement call stay true.
//
// A removed record is { names, use, note? }:
//   names  the 0.14 tools it replaces
//   use    the calls to make instead, in order, as an agent writes them
//   note   what else changed, in a few words

export const TOOL_CHANGES = Object.freeze({
  from: Object.freeze({ version: '0.14.0', tools: 29 }),
  removed: Object.freeze([
    { names: ['what_component_tree'], use: ['what_components({ tree: true })'] },
    { names: ['what_diff_snapshot'], use: ['what_snapshot({ mode: "save" })', 'what_snapshot({ mode: "diff" })'] },
    { names: ['what_watch', 'what_record_window'], use: ['what_events({ after: seq })'] },
    { names: ['what_validate'], use: ['what_lint({ code })'], note: 'it now compiles the snippet, offline' },
    { names: ['what_perf'], use: ['what_diagnose({ focus: "performance" })'] },
  ]),
  added: Object.freeze(['what_events', 'what_why']),
});
