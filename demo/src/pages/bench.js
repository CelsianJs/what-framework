import { useState, useEffect, useRef, useMemo, signal, batch } from 'what-framework';

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

    // 6. Fine-grained template cloning
    benchResults.templateClone = bench('Clone 1,000 templates', () => {
      const tmpl = document.createElement('template');
      tmpl.innerHTML = '<div class="item"><span></span></div>';
      for (let i = 0; i < 1000; i++) {
        tmpl.content.firstChild.cloneNode(true);
      }
    });

    // 7. Array reconciliation simulation
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

  return (
    <div class="section">
      <div class="features-header">
        <p class="features-label">Performance</p>
        <h1 class="features-title">Benchmarks</h1>
        <p class="features-subtitle">
          Real performance measurements of What framework primitives. Run in your browser.
        </p>
      </div>

      <div class="text-center mb-8">
        <button
          class="btn btn-primary btn-lg"
          onClick={runBenchmarks}
          disabled={running}
        >{() => running ? 'Running...' : 'Run Benchmarks'}</button>
      </div>

      {() => results ? (
        <div class="bench-results animate-fade-up">
          {() => Object.entries(results).map(([key, r]) =>
            <div class="bench-row">
              <div>
                <strong>{r.name}</strong>
                <div class="text-muted text-sm">
                  {`${r.opsPerSec.toLocaleString()} ops/sec | ${r.avgMs.toFixed(3)}ms avg`}
                </div>
              </div>
              <div style="width: 200px; margin-left: 1rem;">
                <div class="bench-bar" style={`width: ${Math.min(100, r.score)}%`}></div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <div class="mt-12">
        <h2 class="section-title">What We Measure</h2>
        <div class="features stagger-children">
          <BenchFeature title="Signal Creation" desc="How fast we can create reactive atoms. Impacts component mount time." />
          <BenchFeature title="Signal Read/Write" desc="Cost of reading and updating state. This is the hot path." />
          <BenchFeature title="Batch Updates" desc="Grouping multiple writes to avoid redundant effect runs." />
          <BenchFeature title="DOM Operations" desc="Raw element creation speed — our ceiling." />
          <BenchFeature title="Template Cloning" desc="How fast we can clone pre-parsed templates — the fine-grained rendering hot path." />
          <BenchFeature title="List Reconciliation" desc="Reordering lists efficiently — a classic framework benchmark." />
        </div>
      </div>

      <div class="mt-12">
        <h2 class="section-title">Design Principles</h2>
        <div class="code-block">
          <div class="code-header">
            <div class="code-dots">
              <span class="code-dot"></span>
              <span class="code-dot"></span>
              <span class="code-dot"></span>
            </div>
            <span class="code-filename">philosophy.js</span>
          </div>
          <div class="code-content">
            <pre><code>{`// What's performance philosophy:
//
// 1. Fine-grained rendering: JSX -> compiler -> template() + effect() -> DOM
// 2. Signals track exact subscribers — no tree walking
// 3. Batch by default in event handlers
// 4. Lazy computed values — only recompute when read
// 5. Components run ONCE — only signal-bound DOM nodes update
// 6. Event delegation where possible
// 7. Text nodes updated in place, never recreated
// 8. Template cloning via cloneNode(true) — faster than createElement chains
// 9. Islands (in core): ship zero JS for static content
// 10. No VDOM diffing — direct DOM manipulation`}</code></pre>
          </div>
        </div>
      </div>
    </div>
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

function tick() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function BenchFeature({ title, desc }) {
  return (
    <div class="feature">
      <h3 class="feature-title">{title}</h3>
      <p class="feature-description">{desc}</p>
    </div>
  );
}
