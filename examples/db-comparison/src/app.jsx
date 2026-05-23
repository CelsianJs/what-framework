import { mount, signal, effect, computed, onMount, onCleanup, batch, mapArray } from 'what-framework';
import { createPrismaAdapter } from './adapters/prisma-mock.js';
import { createBatadataAdapter } from './adapters/batadata-mock.js';

// --- Adapters ---
const prisma = createPrismaAdapter('task');
const batadata = createBatadataAdapter('tasks');

// Seed categories
const categories = [
  { id: 'cat1', name: 'Work', color: '#6366f1' },
  { id: 'cat2', name: 'Personal', color: '#22c55e' },
  { id: 'cat3', name: 'Urgent', color: '#ef4444' },
];
prisma._store.set('category_cat1', { ...categories[0], _model: 'category' });
prisma._store.set('category_cat2', { ...categories[1], _model: 'category' });
prisma._store.set('category_cat3', { ...categories[2], _model: 'category' });
batadata._collections.set('categories', new Map(categories.map(c => [c.id, c])));

// --- Shared State ---
const activeTab = signal('crud', 'activeTab');
const perfLog = signal([], 'perfLog');

function logPerf(adapter, op, ms) {
  perfLog(prev => [...prev.slice(-19), { adapter, op, ms, ts: Date.now() }]);
}

// --- Timing helper ---
async function timed(adapterName, op, fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ms = performance.now() - t0;
    logPerf(adapterName, op, Math.round(ms));
    return { data: result, ms: Math.round(ms), error: null };
  } catch (err) {
    const ms = performance.now() - t0;
    logPerf(adapterName, op + ':error', Math.round(ms));
    return { data: null, ms: Math.round(ms), error: err.message };
  }
}

// =============================================================================
// CRUD Panel Component — one per adapter
// =============================================================================
function CrudPanel({ adapter, type }) {
  const items = signal([], 'items');
  const loading = signal(false, 'loading');
  const error = signal(null, 'error');
  const lastOp = signal(null, 'lastOp');

  // Form state
  const title = signal('', 'title');
  const categoryId = signal('cat1', 'categoryId');
  const editingId = signal(null, 'editingId');
  const editTitle = signal('', 'editTitle');

  // Abort controller for cleanup
  let abortCtrl = null;

  async function loadItems() {
    loading(true);
    error(null);
    abortCtrl = new AbortController();
    const sig = abortCtrl.signal;

    const result = type === 'prisma'
      ? await timed(adapter.name, 'findMany', () => adapter.findMany({ orderBy: { createdAt: 'desc' }, include: { category: true } }))
      : await timed(adapter.name, 'query', () => adapter.query({}, { sort: { createdAt: -1 }, expand: ['category'] }));

    if (sig.aborted) return;
    if (result.error) { error(result.error); }
    else { items(result.data); }
    lastOp({ op: 'load', ms: result.ms });
    loading(false);
  }

  async function createItem(e) {
    e.preventDefault();
    const t = title().trim();
    if (!t) return;

    // Optimistic update
    const optimistic = { id: `opt_${Date.now()}`, title: t, completed: false, categoryId: categoryId(), category: categories.find(c => c.id === categoryId()), createdAt: new Date().toISOString(), _optimistic: true };
    items(prev => [optimistic, ...prev]);
    title('');

    const result = type === 'prisma'
      ? await timed(adapter.name, 'create', () => adapter.create({ data: { title: t, completed: false, categoryId: categoryId() } }))
      : await timed(adapter.name, 'insert', () => adapter.insert({ title: t, completed: false, categoryId: categoryId() }));

    if (result.error) {
      error(result.error);
      items(prev => prev.filter(i => i.id !== optimistic.id));
    } else {
      items(prev => prev.map(i => i.id === optimistic.id ? { ...result.data, category: optimistic.category } : i));
    }
    lastOp({ op: 'create', ms: result.ms });
  }

  async function toggleComplete(item) {
    // Optimistic
    items(prev => prev.map(i => i.id === item.id ? { ...i, completed: !i.completed } : i));

    const result = type === 'prisma'
      ? await timed(adapter.name, 'update', () => adapter.update({ where: { id: item.id }, data: { completed: !item.completed } }))
      : await timed(adapter.name, 'patch', () => adapter.patch(item.id, { completed: !item.completed }));

    if (result.error) {
      items(prev => prev.map(i => i.id === item.id ? { ...i, completed: item.completed } : i));
      error(result.error);
    }
    lastOp({ op: 'toggle', ms: result.ms });
  }

  async function deleteItem(item) {
    // Optimistic
    items(prev => prev.filter(i => i.id !== item.id));

    const result = type === 'prisma'
      ? await timed(adapter.name, 'delete', () => adapter.delete({ where: { id: item.id } }))
      : await timed(adapter.name, 'remove', () => adapter.remove(item.id));

    if (result.error) {
      items(prev => [...prev, item]);
      error(result.error);
    }
    lastOp({ op: 'delete', ms: result.ms });
  }

  async function startEdit(item) {
    editingId(item.id);
    editTitle(item.title);
  }

  async function saveEdit(item) {
    const t = editTitle().trim();
    if (!t) return;

    items(prev => prev.map(i => i.id === item.id ? { ...i, title: t } : i));
    editingId(null);

    const result = type === 'prisma'
      ? await timed(adapter.name, 'update', () => adapter.update({ where: { id: item.id }, data: { title: t } }))
      : await timed(adapter.name, 'patch', () => adapter.patch(item.id, { title: t }));

    if (result.error) {
      items(prev => prev.map(i => i.id === item.id ? { ...i, title: item.title } : i));
      error(result.error);
    }
    lastOp({ op: 'update', ms: result.ms });
  }

  // Load on mount, abort on unmount
  onMount(() => { loadItems(); });
  onCleanup(() => { if (abortCtrl) abortCtrl.abort(); });

  const itemCount = computed(() => items().length);
  const doneCount = computed(() => items().filter(i => i.completed).length);

  return (
    <div class="panel">
      <div class="panel-header">
        <div>
          <h3>{adapter.name}</h3>
          <span class="text-muted">{() => `${doneCount()}/${itemCount()} done`}</span>
        </div>
        <div class="flex">
          {() => lastOp() ? <span class="perf">{() => `${lastOp().op}: ${lastOp().ms}ms`}</span> : null}
          <button class="ghost" onClick={loadItems}>Refresh</button>
        </div>
      </div>

      {() => error() ? <div class="error mt">{() => error()}</div> : null}

      <form class="flex mt" onSubmit={createItem}>
        <input
          type="text"
          placeholder="New task..."
          value={title}
          onInput={(e) => title(e.target.value)}
          style="flex:1"
        />
        <select value={categoryId} onChange={(e) => categoryId(e.target.value)}>
          {categories.map(c => <option value={c.id}>{c.name}</option>)}
        </select>
        <button type="submit">Add</button>
      </form>

      <div class="mt" style="max-height:320px;overflow-y:auto">
        {() => loading() && items().length === 0
          ? <div class="loading" style="padding:12px">Loading...</div>
          : null}
        <TaskList
          items={items}
          editingId={editingId}
          editTitle={editTitle}
          onToggle={toggleComplete}
          onDelete={deleteItem}
          onStartEdit={startEdit}
          onSaveEdit={saveEdit}
        />
      </div>
    </div>
  );
}

// =============================================================================
// TaskList — keyed mapArray for efficient reorder
// =============================================================================
function TaskList({ items, editingId, editTitle, onToggle, onDelete, onStartEdit, onSaveEdit }) {
  return (
    <div>
      {mapArray(items, (item) => (
        <TaskRow
          item={item}
          editingId={editingId}
          editTitle={editTitle}
          onToggle={onToggle}
          onDelete={onDelete}
          onStartEdit={onStartEdit}
          onSaveEdit={onSaveEdit}
        />
      ), { key: item => item.id, raw: true })}
    </div>
  );
}

// =============================================================================
// TaskRow — nested component per item
// =============================================================================
function TaskRow({ item, editingId, editTitle, onToggle, onDelete, onStartEdit, onSaveEdit }) {
  const isEditing = computed(() => editingId() === item.id);

  return (
    <div class="item-row" style={() => item._optimistic ? 'opacity:0.6' : ''}>
      <input
        type="checkbox"
        checked={() => item.completed}
        onChange={() => onToggle(item)}
      />
      {() => isEditing() ? (
        <div class="flex" style="flex:1">
          <input
            type="text"
            value={editTitle}
            onInput={(e) => editTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSaveEdit(item); if (e.key === 'Escape') editingId(null); }}
            style="flex:1"
          />
          <button onClick={() => onSaveEdit(item)}>Save</button>
        </div>
      ) : (
        <div class="flex" style="flex:1">
          <span
            style={() => item.completed ? 'text-decoration:line-through;opacity:0.6' : ''}
            onDblClick={() => onStartEdit(item)}
          >
            {item.title}
          </span>
          {() => item.category ? (
            <span class="badge" style={() => `background:${item.category.color}30;color:${item.category.color}`}>
              {item.category.name}
            </span>
          ) : null}
        </div>
      )}
      <button class="danger" onClick={() => onDelete(item)} style="padding:2px 6px;font-size:10px">×</button>
    </div>
  );
}

// =============================================================================
// Performance Tab — unkeyed list of perf entries
// =============================================================================
function PerfTab() {
  return (
    <div class="panel">
      <div class="panel-header">
        <h3>Performance Log</h3>
        <button class="ghost" onClick={() => perfLog([])}>Clear</button>
      </div>
      <div style="max-height:400px;overflow-y:auto">
        {() => perfLog().length === 0
          ? <div class="text-muted" style="padding:12px">No operations yet. Use the CRUD panels above.</div>
          : perfLog().slice().reverse().map(entry => (
              <div class="item-row">
                <span class="badge" style={() => entry.adapter === 'Prisma/Neon' ? 'background:#6366f130;color:#6366f1' : 'background:#22c55e30;color:#22c55e'}>
                  {entry.adapter}
                </span>
                <span style="flex:1">{entry.op}</span>
                <span class="perf">{entry.ms}ms</span>
              </div>
            ))
        }
      </div>
      <PerfSummary />
    </div>
  );
}

function PerfSummary() {
  const prismaAvg = computed(() => {
    const ops = perfLog().filter(e => e.adapter === 'Prisma/Neon' && !e.op.includes('error'));
    return ops.length ? Math.round(ops.reduce((s, e) => s + e.ms, 0) / ops.length) : 0;
  });
  const bataAvg = computed(() => {
    const ops = perfLog().filter(e => e.adapter === 'Batadata' && !e.op.includes('error'));
    return ops.length ? Math.round(ops.reduce((s, e) => s + e.ms, 0) / ops.length) : 0;
  });

  return (
    <div class="mt" style="padding:12px;border-top:1px solid var(--border)">
      <h3>Averages</h3>
      <div class="flex mt">
        <span class="badge" style="background:#6366f130;color:#6366f1">Prisma/Neon</span>
        <span class="perf">{() => prismaAvg() ? `${prismaAvg()}ms` : '—'}</span>
        <span style="margin:0 8px">vs</span>
        <span class="badge" style="background:#22c55e30;color:#22c55e">Batadata</span>
        <span class="perf">{() => bataAvg() ? `${bataAvg()}ms` : '—'}</span>
      </div>
    </div>
  );
}

// =============================================================================
// Bulk Operations Tab — stress test with transactions
// =============================================================================
function BulkTab() {
  const count = signal(10, 'bulkCount');
  const running = signal(false, 'bulkRunning');
  const results = signal(null, 'bulkResults');

  async function runBulk() {
    running(true);
    results(null);
    const n = parseInt(count()) || 10;

    const prismaItems = Array.from({ length: n }, (_, i) => ({ title: `Bulk-P-${i}`, completed: false, categoryId: 'cat1' }));
    const bataItems = Array.from({ length: n }, (_, i) => ({ title: `Bulk-B-${i}`, completed: false, categoryId: 'cat1' }));

    // Prisma: sequential creates (no native batch in Prisma without $transaction)
    const pResult = await timed('Prisma/Neon', `bulk-create-${n}`, async () => {
      const ops = prismaItems.map(data => prisma.create({ data }));
      return prisma.$transaction(ops);
    });

    // Batadata: native batch insert
    const bResult = await timed('Batadata', `bulk-create-${n}`, async () => {
      return batadata.batch(bataItems.map(data => ({ type: 'insert', data })));
    });

    results({ prisma: pResult, batadata: bResult, count: n });
    running(false);
  }

  async function cleanAll() {
    running(true);
    prisma._clear();
    batadata._clear();
    results(null);
    running(false);
  }

  return (
    <div class="panel">
      <div class="panel-header">
        <h3>Bulk Operations</h3>
      </div>
      <div class="flex mt">
        <label class="text-muted">Count:</label>
        <input type="number" value={count} onInput={(e) => count(e.target.value)} style="width:80px" />
        <button onClick={runBulk} disabled={running}>
          {() => running() ? 'Running...' : 'Run Bulk Insert'}
        </button>
        <button class="danger" onClick={cleanAll} disabled={running}>Clear All Data</button>
      </div>
      {() => results() ? (
        <div class="mt" style="padding:12px;background:var(--bg);border-radius:4px">
          <div class="flex">
            <span class="badge" style="background:#6366f130;color:#6366f1">Prisma/Neon</span>
            <span class="perf">{results().prisma.ms}ms for {results().count} inserts</span>
            {() => results().prisma.error ? <span class="error">{results().prisma.error}</span> : <span class="success-text">OK</span>}
          </div>
          <div class="flex mt">
            <span class="badge" style="background:#22c55e30;color:#22c55e">Batadata</span>
            <span class="perf">{results().batadata.ms}ms for {results().count} inserts</span>
            {() => results().batadata.error ? <span class="error">{results().batadata.error}</span> : <span class="success-text">OK</span>}
          </div>
          <div class="text-muted mt">
            {() => {
              const p = results().prisma.ms;
              const b = results().batadata.ms;
              const faster = p < b ? 'Prisma/Neon' : 'Batadata';
              const ratio = p < b ? (b / p).toFixed(1) : (p / b).toFixed(1);
              return `${faster} was ${ratio}x faster for this batch`;
            }}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// Error Simulation Tab
// =============================================================================
function ErrorTab() {
  const errorResult = signal(null, 'errorResult');

  async function triggerNotFound() {
    const pResult = await timed('Prisma/Neon', 'update:not-found', () => prisma.update({ where: { id: 99999 }, data: { title: 'x' } }));
    const bResult = await timed('Batadata', 'patch:not-found', () => batadata.patch('nonexistent', { title: 'x' }));
    errorResult({ prisma: pResult, batadata: bResult });
  }

  return (
    <div class="panel">
      <div class="panel-header">
        <h3>Error Handling</h3>
      </div>
      <div class="mt">
        <button class="danger" onClick={triggerNotFound}>Trigger "Not Found" Error</button>
      </div>
      {() => errorResult() ? (
        <div class="mt" style="padding:12px;background:var(--bg);border-radius:4px">
          <div style="margin-bottom:8px">
            <span class="badge" style="background:#6366f130;color:#6366f1">Prisma/Neon</span>
            <span class="error" style="margin-left:8px">{() => errorResult().prisma.error || 'No error?!'}</span>
            <span class="perf" style="margin-left:8px">{() => errorResult().prisma.ms}ms</span>
          </div>
          <div>
            <span class="badge" style="background:#22c55e30;color:#22c55e">Batadata</span>
            <span class="error" style="margin-left:8px">{() => errorResult().batadata.error || 'No error?!'}</span>
            <span class="perf" style="margin-left:8px">{() => errorResult().batadata.ms}ms</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// =============================================================================
// App Shell
// =============================================================================
function App() {
  const tabs = [
    { id: 'crud', label: 'CRUD' },
    { id: 'perf', label: 'Performance' },
    { id: 'bulk', label: 'Bulk Ops' },
    { id: 'errors', label: 'Errors' },
  ];

  return (
    <div id="app">
      <h1>What Framework — DB Adapter Comparison</h1>
      <h2>Prisma/Neon vs Batadata (Mock Adapters)</h2>

      <div class="tab-bar">
        {tabs.map(tab => (
          <button
            class={() => activeTab() === tab.id ? 'active' : ''}
            onClick={() => activeTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {() => {
        switch (activeTab()) {
          case 'crud': return <CrudView />;
          case 'perf': return <PerfTab />;
          case 'bulk': return <BulkTab />;
          case 'errors': return <ErrorTab />;
        }
      }}
    </div>
  );
}

function CrudView() {
  return (
    <div class="grid">
      <CrudPanel adapter={prisma} type="prisma" />
      <CrudPanel adapter={batadata} type="batadata" />
    </div>
  );
}

// --- Mount ---
mount(<App />, document.getElementById('app'));
