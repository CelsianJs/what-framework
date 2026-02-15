import { h, useState } from '@what/core';
import { Link } from '@what/router';

export function Home() {
  const [count, setCount] = useState(0);

  return h('div', null,
    // Hero Section
    h('section', { class: 'hero' },
      h('div', { class: 'hero-content' },
        // Badge
        h('div', { class: 'hero-badge' },
          h('span', { class: 'hero-badge-dot' }),
          h('span', null, 'v0.1.0 — Unified VNode Architecture'),
        ),

        // Title
        h('h1', { class: 'hero-title' },
          'The closest framework to ',
          h('span', { class: 'hero-title-accent' }, 'vanilla JS'),
        ),

        // Subtitle
        h('p', { class: 'hero-subtitle' },
          'JSX compiled to h() calls with signals-based reactivity, VNode reconciler, and islands architecture. One unified rendering path. Ship less JavaScript.',
        ),

        // CTAs
        h('div', { class: 'hero-actions' },
          h(Link, { href: '/docs', class: 'btn btn-primary btn-lg' }, 'Get Started'),
          h(Link, { href: '/demos', class: 'btn btn-secondary btn-lg' }, 'See Demos'),
        ),

        // Code Preview
        h('div', { class: 'hero-code' },
          h('div', { class: 'code-block' },
            h('div', { class: 'code-header' },
              h('div', { class: 'code-dots' },
                h('span', { class: 'code-dot' }),
                h('span', { class: 'code-dot' }),
                h('span', { class: 'code-dot' }),
              ),
              h('span', { class: 'code-filename' }, 'counter.jsx'),
            ),
            h('div', { class: 'code-content' },
              h('pre', null, h('code', null, `import { mount, signal } from 'what-framework';

function Counter() {
  const count = signal(0);
  return (
    <button onClick={() => count.set(c => c + 1)}>
      Count: {count}
    </button>
  );
}

mount(<Counter />, '#app');`)),
            ),
          ),
        ),
      ),
    ),

    // Stats Section
    h('section', { class: 'stats' },
      h('div', { class: 'container' },
        h('div', { class: 'stats-grid stagger-children' },
          stat('~4kB', 'Gzipped'),
          stat('0', 'Dependencies'),
          stat('VNode', 'Reconciler'),
          stat('JSX', 'First-class'),
        ),
      ),
    ),

    // Interactive Demo
    h('section', { class: 'section' },
      h('div', { class: 'features-header' },
        h('p', { class: 'features-label' }, 'Try it now'),
        h('h2', { class: 'features-title' }, 'Fine-grained reactivity'),
        h('p', { class: 'features-subtitle' },
          'Only the exact DOM nodes that depend on changed data update. No tree diffing, no wasted re-renders.',
        ),
      ),

      h('div', { class: 'demo-card animate-fade-up', style: 'max-width: 400px; margin: 0 auto;' },
        h('div', { class: 'text-center text-muted text-sm mb-4' }, 'Interactive — click to update'),
        h('div', { class: 'counter' },
          h('button', {
            class: 'counter-btn',
            onClick: () => setCount(c => c - 1),
          }, '\u2212'),
          h('span', { class: 'counter-value' }, count),
          h('button', {
            class: 'counter-btn',
            onClick: () => setCount(c => c + 1),
          }, '+'),
        ),
      ),
    ),

    // Features Section
    h('section', { class: 'features-section' },
      h('div', { class: 'container' },
        h('div', { class: 'features-header' },
          h('p', { class: 'features-label' }, 'Why What?'),
          h('h2', { class: 'features-title' }, 'Everything you need, nothing you don\'t'),
          h('p', { class: 'features-subtitle' },
            'A complete framework with JSX, a compiler, and respect for the platform.',
          ),
        ),

        h('div', { class: 'features stagger-children' },
          feature('JSX + Compiler', 'Write familiar JSX that compiles to h() calls through the VNode reconciler. The compiler handles bind:value (compiled to value + onInput props), event modifiers, and more.'),
          feature('Signals', 'Fine-grained reactivity with signals. The VNode reconciler tracks signal dependencies and surgically updates only the DOM nodes that changed.'),
          feature('Islands', 'Ship zero JS by default. Hydrate only the interactive parts with client:idle, client:visible, and client:load directives. Island component is built into core.'),
          feature('Tiny Bundle', 'Core runtime under 4kB gzipped. One unified rendering path: JSX to babel plugin to h() to VNode to reconciler to DOM.'),
          feature('Familiar API', 'React-like hooks (useState, useEffect, useMemo) backed by signals. Easy migration path from React.'),
          feature('File Routing', 'Drop a .jsx file in pages/ and it becomes a route. Dynamic params, catch-all routes, nested layouts — all automatic.'),
        ),
      ),
    ),

    // CTA Section
    h('section', { class: 'cta' },
      h('div', { class: 'container' },
        h('h2', { class: 'cta-title animate-fade-up' }, 'Ready to ship less JavaScript?'),
        h('p', { class: 'cta-subtitle animate-fade-up' },
          'Start building with What in under a minute.',
        ),
        h('div', { class: 'hero-actions animate-fade-up' },
          h('div', { class: 'code-block', style: 'margin: 0; max-width: 320px;' },
            h('div', { class: 'code-content', style: 'padding: 1rem 1.5rem;' },
              h('pre', { style: 'margin: 0;' },
                h('code', { class: 'font-mono' }, 'npx create-what my-app'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function stat(value, label) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-value' }, value),
    h('div', { class: 'stat-label' }, label),
  );
}

function feature(title, desc) {
  return h('div', { class: 'feature' },
    h('h3', { class: 'feature-title' }, title),
    h('p', { class: 'feature-description' }, desc),
  );
}
