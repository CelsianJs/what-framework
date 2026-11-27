// The file tree: one recursive component, a row per entry, its children
// rendered by the same component while the folder is open.

import { onCleanup, useEffect } from 'what-framework';

import { collapseAll, expandAll, isOpen, isSelected, nodes, probes, query, selected, toggle, visible } from './explorer.js';

const ICON = { '.js': 'js', '.ts': 'ts', '.json': '{}', '.md': 'md', '.css': '#' };

function TreeNode({ node }) {
  probes.created++;
  let gone = false;
  onCleanup(() => { gone = true; probes.disposed++; });
  useEffect(() => {
    probes.effectsLive++;
    return () => { probes.effectsLive--; };
  }, []);

  const children = () => {
    const v = visible();
    return v ? node.children.filter((c) => v.has(c.id)) : node.children;
  };
  const ext = node.dir ? '' : node.name.slice(node.name.lastIndexOf('.'));

  return (
    <li data-node={node.id} role="treeitem" aria-expanded={node.dir ? () => isOpen(node.id) : undefined}>
      <div
        class={() => {
          probes.bindingRuns++;
          if (gone) probes.cleanupsLate++;
          return isSelected(node.id) ? 'row selected' : 'row';
        }}
        style={`padding-left:${node.depth * 14 + 6}px`}
        onClick={() => { selected(node.id); if (node.dir) toggle(node.id); }}
      >
        <span class="caret">{node.dir ? (isOpen(node.id) ? '▾' : '▸') : ''}</span>
        <span class={node.dir ? 'icon dir' : 'icon file'}>{node.dir ? '▣' : ICON[ext] || '·'}</span>
        <span class="name">{node.name}</span>
        {node.dir ? <span class="count">{node.children.length}</span> : null}
      </div>
      {node.dir && isOpen(node.id)
        ? <ul role="group">{children().map((c) => <TreeNode key={c.id} node={c} />)}</ul>
        : null}
    </li>
  );
}

export function FileTree() {
  const shown = () => (visible() ? visible().size : null);
  return (
    <section class="pane tree-pane">
      <header class="pane-head">
        <h2>Files</h2>
        <div class="tools">
          <button data-expand-all onClick={expandAll}>Expand all</button>
          <button data-collapse-all onClick={collapseAll}>Collapse all</button>
        </div>
      </header>
      <input
        type="search"
        data-tree-filter
        placeholder={`Filter ${nodes.length.toLocaleString('en-US')} entries`}
        value={query()}
        onInput={(e) => query(e.currentTarget.value)}
      />
      <p class="muted" data-tree-status>
        {shown() === null ? `${nodes.length.toLocaleString('en-US')} entries` : `${shown().toLocaleString('en-US')} match or contain a match`}
      </p>
      <div class="tree-scroll">
        <ul class="tree" role="tree" data-tree>
          <TreeNode node={nodes[0]} />
        </ul>
      </div>
    </section>
  );
}
