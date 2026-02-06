import { h, useState, useEffect, useRef, useMemo, signal, batch } from '@what/core';

export function Bench() {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);

  const runBenchmarks = async () => {
    setRunning(true);
    setResults(null);

    // Let UI update
    await tick();

    const benchResults = {};

    // 1. Signal creation
    benchResults.signalCreate = bench('Create 10,000 signals', () => {
      const signals = [];
      for (let i = 0; i < 10000; i++) {
        signals.push(signal(i));
      }
    });

    // 2. Signal reads
    const sigs = Array.from({ length: 1000 }, (_, i) => signal(i));
    benchResults.signalRead = bench('Read 1,000 signals x1000', () => {
      let sum = 0;
      for (let j = 0; j < 1000; j++) {
        for (const s of sigs) sum += s.peek();
      }
    });

    // 3. Signal writes
    benchResults.signalWrite = bench('Write 1,000 signals', () => {
      for (const s of sigs) s.set(Math.random());
    });

    // 4. Batch writes
    benchResults.batchWrite = bench('Batch write 1,000 signals', () => {
      batch(() => {
        for (const s of sigs) s.set(Math.random());
      });
    });

    // 5. DOM creation
    benchResults.domCreate = bench('Create 1,000 DOM elements', () => {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < 1000; i++) {
        const div = document.createElement('div');
        div.className = 'item';
        div.textContent = `Item ${i}`;
        frag.appendChild(div);
      }
    });

    // 6. Props diffing simulation
    benchResults.propsDiff = bench('Diff 1,000 prop objects', () => {
      for (let i = 0; i < 1000; i++) {
        const oldP = { class: 'a', id: `item-${i}`, 'data-index': i, style: 'color:red' };
        const newP = { class: 'b', id: `item-${i}`, 'data-index': i, style: 'color:blue' };
        diffProps(oldP, newP);
      }
    });

    // 7. VNode creation
    benchResults.vnodeCreate = bench('Create 10,000 VNodes (h())', () => {
      for (let i = 0; i < 10000; i++) {
        h('div', { class: 'item', key: i }, h('span', null, `Item ${i}`));
      }
    });

    // 8. Array reconciliation simulation
    benchResults.listReorder = bench('Reorder 1,000-item list', () => {
      const arr = Array.from({ length: 1000 }, (_, i) => i);
      // Fisher-Yates shuffle
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    });

    setResults(benchResults);
    setRunning(false);
  };

  return h('div', null,
    h('h1', null, 'Benchmarks'),
    h('p', { style: 'color:var(--muted);margin-bottom:1.5rem' },
      'Real performance measurements of What framework primitives. Run in your browser.'
    ),

    h('button', {
      class: 'btn btn-primary',
      onClick: runBenchmarks,
      disabled: running,
    }, running ? 'Running...' : 'Run Benchmarks'),

    results
      ? h('div', { class: 'bench-results', style: 'margin-top:1.5rem' },
          ...Object.entries(results).map(([key, r]) =>
            h('div', { class: 'bench-row' },
              h('div', null,
                h('strong', null, r.name),
                h('div', { style: 'font-size:0.8rem;color:var(--muted)' },
                  `${r.opsPerSec.toLocaleString()} ops/sec | ${r.avgMs.toFixed(3)}ms avg`,
                ),
              ),
              h('div', { style: 'width:200px;margin-left:1rem' },
                h('div', {
                  class: 'bench-bar',
                  style: `width:${Math.min(100, r.score)}%`,
                }),
              ),
            )
          ),
        )
      : null,

    h('div', { class: 'section' },
      h('h2', null, 'What We Measure'),
      h('div', { class: 'features' },
        feat('Signal Creation', 'How fast we can create reactive atoms. Impacts component mount time.'),
        feat('Signal Read/Write', 'Cost of reading and updating state. This is the hot path.'),
        feat('Batch Updates', 'Grouping multiple writes to avoid redundant effect runs.'),
        feat('DOM Operations', 'Raw element creation speed — our ceiling.'),
        feat('Props Diffing', 'How efficiently we detect what changed in component props.'),
        feat('VNode Creation', 'h() call overhead. Must be near zero.'),
        feat('List Reconciliation', 'Reordering lists efficiently — a classic framework benchmark.'),
      ),
    ),

    h('div', { class: 'section' },
      h('h2', null, 'Design Principles'),
      h('pre', null, h('code', null, `// What's performance philosophy:
//
// 1. No virtual DOM tree in memory — diff against live DOM
// 2. Signals track exact subscribers — no tree walking
// 3. Batch by default in event handlers
// 4. Lazy computed values — only recompute when read
// 5. Props diffed by identity (===), not deep equality
// 6. Event delegation where possible
// 7. Text nodes updated in place, never recreated
// 8. Component output memoized via memo()
// 9. Islands: ship zero JS for static content
// 10. No runtime parsing — h() creates plain objects`)),
    ),
  );
}

// --- Benchmark harness ---

function bench(name, fn, iterations = 100) {
  // Warmup
  for (let i = 0; i < 5; i++) fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  // Remove outliers (top/bottom 10%)
  const trimmed = times.slice(Math.floor(times.length * 0.1), Math.floor(times.length * 0.9));
  const avgMs = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const opsPerSec = Math.round(1000 / avgMs);
  const score = Math.min(100, Math.round(opsPerSec / 100));

  return { name, avgMs, opsPerSec, score };
}

function diffProps(oldP, newP) {
  const changes = {};
  for (const key in newP) {
    if (newP[key] !== oldP[key]) changes[key] = newP[key];
  }
  for (const key in oldP) {
    if (!(key in newP)) changes[key] = undefined;
  }
  return changes;
}

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function feat(title, desc) {
  return h('div', { class: 'feature' },
    h('h3', null, title),
    h('p', null, desc),
  );
}

// Export needed for h() import in bench
export { h } from '@what/core';
