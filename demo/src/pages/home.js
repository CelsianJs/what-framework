import { useState } from 'what-framework';
import { Link } from 'what-framework/router';

export function Home() {
  const [count, setCount] = useState(0);

  return (
    <div>
      {/* Hero Section */}
      <section class="hero">
        <div class="hero-content">
          {/* Badge */}
          <div class="hero-badge">
            <span class="hero-badge-dot"></span>
            <span>v0.2.0 — Fine-Grained Rendering</span>
          </div>

          {/* Title */}
          <h1 class="hero-title">
            The closest framework to <span class="hero-title-accent">vanilla JS</span>
          </h1>

          {/* Subtitle */}
          <p class="hero-subtitle">
            JSX compiled to fine-grained DOM operations with signal-based reactivity
            and islands architecture. Components run once. Ship less JavaScript.
          </p>

          {/* CTAs */}
          <div class="hero-actions">
            <Link href="/docs" class="btn btn-primary btn-lg">Get Started</Link>
            <Link href="/demos" class="btn btn-secondary btn-lg">See Demos</Link>
          </div>

          {/* Code Preview */}
          <div class="hero-code">
            <div class="code-block">
              <div class="code-header">
                <div class="code-dots">
                  <span class="code-dot"></span>
                  <span class="code-dot"></span>
                  <span class="code-dot"></span>
                </div>
                <span class="code-filename">counter.jsx</span>
              </div>
              <div class="code-content">
                <pre><code>{`import { mount, signal } from 'what-framework';

function Counter() {
  const count = signal(0);
  return (
    <button onClick={() => count.set(c => c + 1)}>
      Count: {count()}
    </button>
  );
}

mount(<Counter />, '#app');`}</code></pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section class="stats">
        <div class="container">
          <div class="stats-grid stagger-children">
            <Stat value="~4kB" label="Gzipped" />
            <Stat value="0" label="Dependencies" />
            <Stat value="Fine" label="Grained" />
            <Stat value="JSX" label="First-class" />
          </div>
        </div>
      </section>

      {/* Interactive Demo */}
      <section class="section">
        <div class="features-header">
          <p class="features-label">Try it now</p>
          <h2 class="features-title">Fine-grained reactivity</h2>
          <p class="features-subtitle">
            Only the exact DOM nodes that depend on changed data update.
            No tree diffing, no wasted re-renders.
          </p>
        </div>

        <div class="demo-card animate-fade-up" style="max-width: 400px; margin: 0 auto;">
          <div class="text-center text-muted text-sm mb-4">Interactive — click to update</div>
          <div class="counter">
            <button class="counter-btn" onClick={() => setCount(c => c - 1)}>{'\u2212'}</button>
            <span class="counter-value">{count}</span>
            <button class="counter-btn" onClick={() => setCount(c => c + 1)}>+</button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section class="features-section">
        <div class="container">
          <div class="features-header">
            <p class="features-label">Why What?</p>
            <h2 class="features-title">Everything you need, nothing you don't</h2>
            <p class="features-subtitle">
              A complete framework with JSX, a compiler, and respect for the platform.
            </p>
          </div>

          <div class="features stagger-children">
            <Feature title="JSX + Compiler" desc="Write familiar JSX that compiles to fine-grained DOM operations. The compiler handles bind:value, event modifiers, and more." />
            <Feature title="Signals" desc="Fine-grained reactivity with signals. Only the specific DOM nodes that depend on changed signals update — no diffing needed." />
            <Feature title="Islands" desc="Ship zero JS by default. Hydrate only the interactive parts with client:idle, client:visible, and client:load directives." />
            <Feature title="Tiny Bundle" desc="Core runtime under 4kB gzipped. Fine-grained rendering path: JSX to compiler to template() + effect() to DOM." />
            <Feature title="Familiar API" desc="React-like hooks (useState, useEffect, useMemo) backed by signals. Easy migration path from React." />
            <Feature title="File Routing" desc="Drop a .jsx file in pages/ and it becomes a route. Dynamic params, catch-all routes, nested layouts — all automatic." />
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section class="cta">
        <div class="container">
          <h2 class="cta-title animate-fade-up">Ready to ship less JavaScript?</h2>
          <p class="cta-subtitle animate-fade-up">
            Start building with What in under a minute.
          </p>
          <div class="hero-actions animate-fade-up">
            <div class="code-block" style="margin: 0; max-width: 320px;">
              <div class="code-content" style="padding: 1rem 1.5rem;">
                <pre style="margin: 0;">
                  <code class="font-mono">npx create-what my-app</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div class="stat">
      <div class="stat-value">{value}</div>
      <div class="stat-label">{label}</div>
    </div>
  );
}

function Feature({ title, desc }) {
  return (
    <div class="feature">
      <h3 class="feature-title">{title}</h3>
      <p class="feature-description">{desc}</p>
    </div>
  );
}
