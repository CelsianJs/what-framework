import { signal, effect, mount, useEffect, useRef, useState } from 'what-framework';
import { pkgs, categories, sortOrder, badgeMap, labelMap, npmPkg, REPOS } from './data.js';

// ── SVG Icons ──
function DownloadIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1a.5.5 0 01.5.5v9.793l3.146-3.147a.5.5 0 01.708.708l-4 4a.5.5 0 01-.708 0l-4-4a.5.5 0 01.708-.708L7.5 11.293V1.5A.5.5 0 018 1z"/>
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

function NpmIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <path d="M0 0v16h16V0H0zm13 13H8V5h5v8z"/>
    </svg>
  );
}

function GitHubStroke() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
    </svg>
  );
}

// ── Scroll Reveal Hook ──
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        el.classList.add('visible');
        obs.disconnect();
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return ref;
}

// ── Counter Animation ──
function Counter({ target, suffix, colorClass, children }) {
  const ref = useRef(null);
  const [value, setValue] = useState(0);
  const counted = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !counted.current) {
        counted.current = true;
        const dur = 1600;
        const start = performance.now();
        function tick(now) {
          const p = Math.min((now - start) / dur, 1);
          const ease = 1 - Math.pow(1 - p, 3);
          setValue(Math.round(ease * target));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
        obs.disconnect();
      }
    }, { threshold: 0.4 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div class="stat" ref={ref}>
      <div class={`stat-number ${colorClass}`}>{value}{suffix || ''}</div>
      <div class="stat-label">{children}</div>
    </div>
  );
}

// ── Package Card ──
function PackageCard({ pkg }) {
  const npm = npmPkg(pkg.n);
  const repo = REPOS[npm];
  const npmUrl = 'https://www.npmjs.com/package/' + encodeURIComponent(npm);
  const ghUrl = repo ? 'https://github.com/' + repo : null;

  return (
    <div class={`pkg-card ${pkg.s === 'investigating' ? 'investigating' : ''}`}>
      <div class="pkg-top">
        <div class="pkg-name">{pkg.n}</div>
        <div class={`pkg-badge ${badgeMap[pkg.s]}`}>{labelMap[pkg.s]}</div>
      </div>
      <div class="pkg-meta">
        <span class="pkg-dl"><DownloadIcon /> {pkg.d}/wk</span>
        <span class="pkg-cat">{pkg.c}</span>
        <span class="pkg-links">
          {ghUrl ? <a href={ghUrl} class="pkg-link" title="GitHub" target="_blank" rel="noopener"><GitHubIcon /></a> : null}
          <a href={npmUrl} class="pkg-link" title="npm" target="_blank" rel="noopener"><NpmIcon /></a>
        </span>
      </div>
      <div class="pkg-note">{pkg.t}</div>
    </div>
  );
}

// ── Filter Bar ──
function FilterBar({ active, onSelect }) {
  return (
    <div class="filter-bar">
      {categories.map(cat => {
        const count = cat === 'All' ? pkgs.length : pkgs.filter(p => p.c === cat).length;
        return (
          <button
            class={`filter-btn ${cat === active ? 'active' : ''}`}
            onclick={() => onSelect(cat)}
          >
            {cat} ({count})
          </button>
        );
      })}
    </div>
  );
}

// ── Package Grid ──
function PackageGrid({ filter }) {
  const gridRef = useRef(null);

  // Re-trigger stagger on filter change
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('visible');
    requestAnimationFrame(() => el.classList.add('visible'));
  }, [filter]);

  const list = (filter === 'All' ? pkgs : pkgs.filter(p => p.c === filter))
    .slice()
    .sort((a, b) => (sortOrder[a.s] ?? 9) - (sortOrder[b.s] ?? 9));

  return (
    <div class="pkg-grid stagger" ref={gridRef}>
      {list.map(p => <PackageCard pkg={p} />)}
    </div>
  );
}

// ── Nav ──
function Nav() {
  return (
    <nav>
      <div class="container">
        <a href="/" class="nav-logo">
          <span class="w">W</span>
          <em>what</em>-react
        </a>
        <ul class="nav-links">
          <li><a href="#packages">Packages</a></li>
          <li><a href="#how">How It Works</a></li>
          <li><a href="#architecture">Architecture</a></li>
          <li><a href="#benchmarks">Performance</a></li>
          <li><a href="https://github.com/zvndev/what-fw" class="nav-cta">GitHub</a></li>
        </ul>
      </div>
    </nav>
  );
}

// ── Hero ──
function Hero() {
  return (
    <section class="hero">
      <div class="container">
        <div class="hero-pill"><span class="dot"></span> what-react v0.1.0</div>
        <h1><span class="grad">100+ React Libraries.</span><br />Zero Changes.</h1>
        <p class="hero-sub">
          What Framework's <code>what-react</code> compat layer lets you use the React ecosystem
          on a signals-powered engine. Same imports. Same API. Faster runtime.
        </p>
        <div class="stats-bar">
          <Counter target={90} suffix="" colorClass="c-blue">Confirmed Working</Counter>
          <Counter target={96} suffix="+" colorClass="c-cyan">Total Compatible</Counter>
          <Counter target={0} suffix="" colorClass="c-purple">Lines Changed</Counter>
          <Counter target={500} suffix="M+" colorClass="c-green">Downloads/Week</Counter>
        </div>
      </div>
    </section>
  );
}

// ── Packages Section ──
function Packages() {
  const [filter, setFilter] = useState('All');
  const revealRef = useReveal();
  const filterRef = useReveal();
  const ctaRef = useReveal();

  return (
    <section id="packages">
      <div class="container">
        <div class="reveal" ref={revealRef}>
          <div class="section-label">Ecosystem</div>
          <h2 class="section-title">Every Library You Already Use</h2>
          <p class="section-desc">Each package was installed, imported, and tested in a live app running on What's compat layer. No wrappers. No patches. No forks.</p>
        </div>

        <div class="reveal" ref={filterRef}>
          <FilterBar active={filter} onSelect={setFilter} />
        </div>
        <PackageGrid filter={filter} />

        <div class="submit-cta reveal" ref={ctaRef}>
          <div class="submit-cta-text">
            <h3>Tested a React library that works?</h3>
            <p>Submit it to the community list. If it uses hooks & standard React APIs, it probably just works.</p>
          </div>
          <a href="https://github.com/zvndev/what-fw/issues/new?labels=compat-report&template=compat-report.md&title=%5BCompat%5D+Package+Name" target="_blank" rel="noopener">
            <GitHubIcon />
            Submit a Package
          </a>
        </div>
      </div>
    </section>
  );
}

// ── How It Works ──
function HowItWorks() {
  const stepsRef = useReveal();
  const codeRef = useReveal();
  const headerRef = useReveal();

  return (
    <section id="how" class="how-section">
      <div class="container">
        <div class="reveal" ref={headerRef}>
          <div class="section-label">Under the Hood</div>
          <h2 class="section-title">One Plugin. Zero Config.</h2>
          <p class="section-desc">Your React libraries never know they're running on signals.</p>
        </div>
        <div class="how-grid">
          <div class="how-steps reveal" ref={stepsRef}>
            <div class="how-step">
              <div class="step-n">1</div>
              <div class="step-body">
                <h3>Install the compat layer</h3>
                <p>Add <code>what-react</code> to your project. It reimplements React's entire public API on What's signals engine.</p>
              </div>
            </div>
            <div class="how-step">
              <div class="step-n">2</div>
              <div class="step-body">
                <h3>Add one Vite plugin</h3>
                <p><code>reactCompat()</code> auto-detects every installed React package and aliases <code>react</code> / <code>react-dom</code> to <code>what-react</code>.</p>
              </div>
            </div>
            <div class="how-step">
              <div class="step-n">3</div>
              <div class="step-body">
                <h3>Signals power the runtime</h3>
                <p><code>useState</code> becomes a signal. <code>useEffect</code> becomes an effect. The API surface is preserved, but the engine underneath is fine-grained.</p>
              </div>
            </div>
            <div class="how-step">
              <div class="step-n">4</div>
              <div class="step-body">
                <h3>Ship it</h3>
                <p>Your existing React code, tests, and libraries all work. Only the runtime changed.</p>
              </div>
            </div>
          </div>
          <div class="code-block reveal" ref={codeRef}>
            <div class="code-bar">
              <div class="code-dot r"></div>
              <div class="code-dot y"></div>
              <div class="code-dot g"></div>
              <span class="code-file">vite.config.js</span>
            </div>
            <div class="code-body" dangerouslySetInnerHTML={{ __html: `<span class="kw">import</span> { <span class="fn">defineConfig</span> } <span class="kw">from</span> <span class="st">'vite'</span>;<br>
<span class="kw">import</span> { <span class="fn">reactCompat</span> } <span class="kw">from</span> <span class="st">'what-react/vite'</span>;<br>
<br>
<span class="kw">export default</span> <span class="fn">defineConfig</span>({<br>
&nbsp;&nbsp;<span class="pr">plugins</span>: [<span class="fn">reactCompat</span>()],<br>
});<br>
<br>
<span class="cm">// That's it. Every React import now</span><br>
<span class="cm">// resolves to what-react automatically.</span><br>
<span class="cm">//</span><br>
<span class="cm">// Zustand, Framer Motion, Radix UI,</span><br>
<span class="cm">// React Hook Form, TanStack Query...</span><br>
<span class="cm">// they all just work.</span>` }}></div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Architecture ──
function Architecture() {
  const headerRef = useReveal();
  const featRef = useReveal();
  const apiRef = useReveal();

  return (
    <section id="architecture" class="arch-section">
      <div class="container">
        <div class="reveal" ref={headerRef}>
          <div class="section-label">Architecture</div>
          <h2 class="section-title">Not a Shim. A Runtime.</h2>
          <p class="section-desc">Every React API, reimplemented from scratch on signals. Class components, portals, context, Suspense — all of it.</p>
        </div>
        <div class="arch-grid">
          <div class="reveal" ref={featRef}>
            <div class="arch-features">
              <div class="arch-feat">
                <div class="arch-feat-icon">&#x26A1;</div>
                <div>
                  <h4>Fine-Grained Signals</h4>
                  <p>useState, useEffect, useMemo all map to signals. Only DOM nodes that depend on changed data update — no tree diffing.</p>
                </div>
              </div>
              <div class="arch-feat">
                <div class="arch-feat-icon">&#x1F3D7;</div>
                <div>
                  <h4>Full Context & Providers</h4>
                  <p>createContext, Provider, Consumer, and useContext. Nested providers, default values, render-prop consumers.</p>
                </div>
              </div>
              <div class="arch-feat">
                <div class="arch-feat-icon">&#x1F9EC;</div>
                <div>
                  <h4>Class Components</h4>
                  <p>ES6 class components with lifecycle methods are automatically detected and wrapped. componentDidMount, componentDidUpdate, componentWillUnmount.</p>
                </div>
              </div>
              <div class="arch-feat">
                <div class="arch-feat-icon">&#x1F500;</div>
                <div>
                  <h4>Portals & Refs</h4>
                  <p>createPortal renders into external DOM nodes. forwardRef, useImperativeHandle, createRef work as expected.</p>
                </div>
              </div>
              <div class="arch-feat">
                <div class="arch-feat-icon">&#x1F504;</div>
                <div>
                  <h4>React 18 APIs</h4>
                  <p>useSyncExternalStore, useTransition, useDeferredValue, useId, Suspense, and lazy loading.</p>
                </div>
              </div>
            </div>
          </div>

          <div class="code-block api-block reveal" ref={apiRef}>
            <div class="code-bar">
              <div class="code-dot r"></div>
              <div class="code-dot y"></div>
              <div class="code-dot g"></div>
              <span class="code-file">what-react API surface</span>
            </div>
            <pre dangerouslySetInnerHTML={{ __html: `<span class="cm">// Hooks</span>
<span class="key">useState</span>, <span class="key">useEffect</span>, <span class="key">useLayoutEffect</span>,
<span class="key">useMemo</span>, <span class="key">useCallback</span>, <span class="key">useRef</span>,
<span class="key">useContext</span>, <span class="key">useReducer</span>,
<span class="key">useImperativeHandle</span>, <span class="key">useId</span>,
<span class="key">useSyncExternalStore</span>,
<span class="key">useTransition</span>, <span class="key">useDeferredValue</span>,

<span class="cm">// Components</span>
<span class="key">Fragment</span>, <span class="key">Suspense</span>, <span class="key">StrictMode</span>,
<span class="key">Component</span>, <span class="key">PureComponent</span>,

<span class="cm">// Functions</span>
<span class="key">createElement</span>, <span class="key">createContext</span>,
<span class="key">createRef</span>, <span class="key">forwardRef</span>,
<span class="key">cloneElement</span>, <span class="key">isValidElement</span>,
<span class="key">memo</span>, <span class="key">lazy</span>, <span class="key">startTransition</span>,

<span class="cm">// Children</span>
<span class="key">Children</span><span class="punc">.</span>map, <span class="key">Children</span><span class="punc">.</span>forEach,
<span class="key">Children</span><span class="punc">.</span>count, <span class="key">Children</span><span class="punc">.</span>toArray,

<span class="cm">// React DOM</span>
<span class="key">createRoot</span>, <span class="key">createPortal</span>,
<span class="key">flushSync</span>, <span class="key">hydrateRoot</span>,

<span class="cm">// JSX Runtime</span>
<span class="key">jsx</span>, <span class="key">jsxs</span>, <span class="key">jsxDEV</span>` }}></pre>
          </div>
        </div>
      </div>
    </section>
  );
}

// ── Benchmarks ──
function Benchmarks() {
  const headerRef = useReveal();
  const cardsRef = useRef(null);

  useEffect(() => {
    const el = cardsRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        el.classList.add('visible');
        obs.disconnect();
      }
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const benchmarks = [
    { x: '2.5x', lib: 'Zustand', met: 'Store updates/sec' },
    { x: '3.5x', lib: 'React Hook Form', met: 'Form reset speed' },
    { x: '2.8x', lib: 'TanStack Table', met: 'Row creation speed' },
    { x: '3.0x', lib: 'Jotai', met: 'Atom updates/sec' },
    { x: '10x', lib: 'TanStack Virtual', met: 'Scroll performance' },
  ];

  return (
    <section id="benchmarks" class="bench-section">
      <div class="container">
        <div class="reveal" ref={headerRef}>
          <div class="section-label">Performance</div>
          <h2 class="section-title">Faster Than React.<br />With React Libraries.</h2>
          <p class="section-desc" style="margin: 0 auto;">Same libraries, same API. Signals instead of virtual DOM diffing.</p>
        </div>
        <div class="bench-cards stagger" ref={cardsRef}>
          {benchmarks.map(b => (
            <div class="bench-card">
              <div class="bench-x">{b.x}</div>
              <div class="bench-lib">{b.lib}</div>
              <div class="bench-met">{b.met}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── CTA ──
function CallToAction() {
  const ref = useReveal();

  return (
    <section class="cta-section">
      <div class="container reveal" ref={ref}>
        <h2 class="cta-title">Your React code.<br />Our signals engine.</h2>
        <p class="cta-desc">Migrate your entire project in under a minute. Keep every library you depend on.</p>
        <div class="cta-buttons">
          <a href="https://github.com/zvndev/what-fw" class="btn btn-primary">
            <GitHubStroke />
            View on GitHub
          </a>
          <a href="https://www.npmjs.com/package/what-react" class="btn btn-ghost">npm install what-react</a>
        </div>
      </div>
    </section>
  );
}

// ── Footer ──
function Footer() {
  return (
    <footer>
      <div class="container">
        <p>What Framework — <a href="https://github.com/zvndev/what-fw">GitHub</a></p>
        <div class="built-with">
          Built with <span class="fw-badge">What Framework</span>
        </div>
      </div>
    </footer>
  );
}

// ── App ──
export default function App() {
  return (
    <>
      <div class="bg-grid"></div>
      <div class="bg-glow"></div>
      <Nav />
      <Hero />
      <Packages />
      <HowItWorks />
      <Architecture />
      <Benchmarks />
      <CallToAction />
      <Footer />
    </>
  );
}
