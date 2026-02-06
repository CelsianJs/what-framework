// What Framework - Islands Architecture
// Each interactive piece of the page is an "island" — a self-contained
// component that hydrates independently. The rest is static HTML.
//
// Modes:
//   'static'  - No JS shipped. Pure HTML. (nav, footer, etc.)
//   'idle'    - Hydrate when browser is idle (requestIdleCallback)
//   'visible' - Hydrate when scrolled into view (IntersectionObserver)
//   'load'    - Hydrate immediately on page load
//   'media'   - Hydrate when media query matches (e.g., mobile-only)
//   'action'  - Hydrate on first user interaction (click, focus, hover)

import { mount } from '../../core/src/index.js';

const islandRegistry = new Map();

// --- Register an island component ---

export function island(name, loader, opts = {}) {
  islandRegistry.set(name, {
    loader,  // () => import('./MyComponent.js')
    mode: opts.mode || 'idle',
    media: opts.media || null,
  });
}

// --- Island wrapper for SSR ---
// Renders the static HTML with a marker the client can find.

export function Island({ name, props = {}, children, mode }) {
  const resolvedMode = mode || islandRegistry.get(name)?.mode || 'idle';
  // Server: render as a div with data attributes for hydration
  return {
    tag: 'div',
    props: {
      'data-island': name,
      'data-island-mode': resolvedMode,
      'data-island-props': JSON.stringify(props),
    },
    children: children || [],
    key: null,
    _vnode: true,
  };
}

// --- Client-side hydration ---

export function hydrateIslands() {
  const islands = document.querySelectorAll('[data-island]');

  for (const el of islands) {
    const name = el.dataset.island;
    const mode = el.dataset.islandMode || 'idle';
    const props = JSON.parse(el.dataset.islandProps || '{}');
    const entry = islandRegistry.get(name);

    if (!entry) {
      console.warn(`[what] Island "${name}" not registered`);
      continue;
    }

    scheduleHydration(el, entry, props, mode);
  }
}

function scheduleHydration(el, entry, props, mode) {
  const hydrate = async () => {
    const mod = await entry.loader();
    const Component = mod.default || mod;
    mount(Component(props), el);
    el.removeAttribute('data-island');
    el.removeAttribute('data-island-mode');
    el.removeAttribute('data-island-props');
  };

  switch (mode) {
    case 'load':
      hydrate();
      break;

    case 'idle':
      if ('requestIdleCallback' in window) {
        requestIdleCallback(hydrate);
      } else {
        setTimeout(hydrate, 200);
      }
      break;

    case 'visible': {
      const observer = new IntersectionObserver((entries, obs) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            obs.disconnect();
            hydrate();
            break;
          }
        }
      }, { rootMargin: '200px' });
      observer.observe(el);
      break;
    }

    case 'media': {
      const mq = window.matchMedia(entry.media || '(max-width: 768px)');
      if (mq.matches) {
        hydrate();
      } else {
        mq.addEventListener('change', (e) => {
          if (e.matches) hydrate();
        }, { once: true });
      }
      break;
    }

    case 'action': {
      const events = ['click', 'focus', 'mouseover', 'touchstart'];
      const handler = () => {
        events.forEach(e => el.removeEventListener(e, handler));
        hydrate();
      };
      events.forEach(e => el.addEventListener(e, handler, { once: true, passive: true }));
      break;
    }

    default:
      hydrate();
  }
}

// --- Auto-discover islands from data attributes ---
// Call this once on the client to set up all islands.

export function autoIslands(registry) {
  for (const [name, config] of Object.entries(registry)) {
    island(name, config.loader || config, { mode: config.mode || 'idle', media: config.media });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hydrateIslands);
    } else {
      hydrateIslands();
    }
  }
}
