// What Framework Playground — Example Code Snippets
// All examples use h() or html`` tagged templates (no JSX — runs in browser without a compiler)

export const examples = [
  {
    id: 'hello-world',
    title: 'Hello World',
    description: 'Minimal signal + rendering',
    code: `import { signal, effect, h, mount } from 'what-framework';

// Signals are reactive values — read with (), write with (newVal)
const name = signal('World', 'name');

function HelloWorld() {
  return h('div', { class: 'hello' },
    h('h1', {},
      'Hello, ',
      // Wrap in a function for fine-grained reactivity
      () => name(),
      '!'
    ),
    h('input', {
      type: 'text',
      value: name(),
      placeholder: 'Type your name...',
      oninput: (e) => name(e.target.value),
      style: 'padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 16px; width: 250px; margin-top: 16px;',
    }),
    h('p', { style: 'margin-top: 12px; color: #888;' },
      'Components run ONCE. Only the text updates.'
    ),
  );
}

mount(h(HelloWorld), '#app');
`,
  },
  {
    id: 'counter',
    title: 'Counter',
    description: 'Signal read/write with buttons',
    code: `import { signal, h, mount } from 'what-framework';

function Counter() {
  const count = signal(0, 'count');

  return h('div', { style: 'text-align: center;' },
    h('h2', {}, 'Counter'),
    h('div', {
      style: 'font-size: 72px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 24px 0;',
    }, () => count()),
    h('div', { style: 'display: flex; gap: 12px; justify-content: center;' },
      h('button', {
        onclick: () => count(c => c - 1),
        style: 'padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 18px; cursor: pointer;',
      }, '- 1'),
      h('button', {
        onclick: () => count(0),
        style: 'padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: #333; color: #eee; font-size: 18px; cursor: pointer;',
      }, 'Reset'),
      h('button', {
        onclick: () => count(c => c + 1),
        style: 'padding: 10px 24px; border-radius: 8px; border: 1px solid #8b5cf6; background: #8b5cf6; color: #fff; font-size: 18px; cursor: pointer;',
      }, '+ 1'),
    ),
    h('p', { style: 'margin-top: 16px; color: #888;' },
      () => \`The count is \${count() === 0 ? 'zero' : count() > 0 ? 'positive' : 'negative'}\`,
    ),
  );
}

mount(h(Counter), '#app');
`,
  },
  {
    id: 'todo-list',
    title: 'Todo List',
    description: 'Signals + dynamic list rendering',
    code: `import { signal, computed, h, mount } from 'what-framework';

function TodoApp() {
  const todos = signal([], 'todos');
  const input = signal('', 'input');
  const filter = signal('all', 'filter');

  const filteredTodos = computed(() => {
    const list = todos();
    const f = filter();
    if (f === 'active') return list.filter(t => !t.done);
    if (f === 'completed') return list.filter(t => t.done);
    return list;
  });

  const remaining = computed(() =>
    todos().filter(t => !t.done).length
  );

  const addTodo = () => {
    const text = input().trim();
    if (!text) return;
    todos(prev => [...prev, { id: Date.now(), text, done: false }]);
    input('');
  };

  const toggle = (id) => {
    todos(prev => prev.map(t =>
      t.id === id ? { ...t, done: !t.done } : t
    ));
  };

  const remove = (id) => {
    todos(prev => prev.filter(t => t.id !== id));
  };

  const btnStyle = (active) =>
    \`padding: 6px 14px; border-radius: 6px; border: 1px solid \${active ? '#8b5cf6' : '#444'}; background: \${active ? '#8b5cf6' : 'transparent'}; color: \${active ? '#fff' : '#aaa'}; cursor: pointer; font-size: 13px;\`;

  return h('div', { style: 'max-width: 480px; margin: 0 auto;' },
    h('h2', {}, 'Todo List'),
    // Input row
    h('div', { style: 'display: flex; gap: 8px; margin: 16px 0;' },
      h('input', {
        type: 'text',
        value: input(),
        placeholder: 'What needs to be done?',
        oninput: (e) => input(e.target.value),
        onkeydown: (e) => e.key === 'Enter' && addTodo(),
        style: 'flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px;',
      }),
      h('button', {
        onclick: addTodo,
        style: 'padding: 10px 20px; border-radius: 8px; border: none; background: #8b5cf6; color: #fff; font-size: 14px; cursor: pointer;',
      }, 'Add'),
    ),
    // Filter tabs
    h('div', { style: 'display: flex; gap: 8px; margin-bottom: 16px;' },
      h('button', { onclick: () => filter('all'), style: () => btnStyle(filter() === 'all') }, 'All'),
      h('button', { onclick: () => filter('active'), style: () => btnStyle(filter() === 'active') }, 'Active'),
      h('button', { onclick: () => filter('completed'), style: () => btnStyle(filter() === 'completed') }, 'Completed'),
    ),
    // Todo items
    h('div', {},
      () => filteredTodos().length === 0
        ? h('p', { style: 'color: #666; text-align: center; padding: 32px;' }, 'No todos yet. Add one above!')
        : h('div', {},
            ...filteredTodos().map(todo =>
              h('div', {
                key: todo.id,
                style: 'display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; margin-bottom: 4px; background: #1a1a2e;',
              },
                h('input', {
                  type: 'checkbox',
                  checked: todo.done,
                  onchange: () => toggle(todo.id),
                  style: 'width: 18px; height: 18px; accent-color: #8b5cf6; cursor: pointer;',
                }),
                h('span', {
                  style: \`flex: 1; \${todo.done ? 'text-decoration: line-through; color: #666;' : ''}\`,
                }, todo.text),
                h('button', {
                  onclick: () => remove(todo.id),
                  style: 'background: none; border: none; color: #666; cursor: pointer; font-size: 18px;',
                }, '\\u00d7'),
              )
            )
          )
    ),
    // Footer
    h('div', { style: 'margin-top: 12px; color: #888; font-size: 13px;' },
      () => \`\${remaining()} item\${remaining() === 1 ? '' : 's'} remaining\`,
    ),
  );
}

mount(h(TodoApp), '#app');
`,
  },
  {
    id: 'computed-values',
    title: 'Computed Values',
    description: 'computed() and derived state',
    code: `import { signal, computed, h, mount } from 'what-framework';

function PriceCalculator() {
  const price = signal(29.99, 'price');
  const quantity = signal(1, 'quantity');
  const taxRate = signal(0.08, 'taxRate');
  const coupon = signal('', 'coupon');

  // Computed values — lazy, cached, auto-tracked
  const subtotal = computed(() => price() * quantity());
  const discount = computed(() => {
    if (coupon() === 'SAVE20') return subtotal() * 0.2;
    if (coupon() === 'SAVE10') return subtotal() * 0.1;
    return 0;
  });
  const tax = computed(() => (subtotal() - discount()) * taxRate());
  const total = computed(() => subtotal() - discount() + tax());
  const savings = computed(() => discount() > 0 ? discount() + ' saved!' : '');

  const fmt = (n) => '$' + n.toFixed(2);
  const labelStyle = 'color: #aaa; font-size: 13px; margin-bottom: 4px;';
  const inputStyle = 'padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px; width: 100%;';

  return h('div', { style: 'max-width: 400px; margin: 0 auto;' },
    h('h2', {}, 'Price Calculator'),
    h('p', { style: 'color: #888; margin-bottom: 20px;' }, 'All totals are computed() values — cached and reactive.'),
    // Inputs
    h('div', { style: 'display: grid; gap: 16px; margin-bottom: 24px;' },
      h('div', {},
        h('label', { style: labelStyle }, 'Unit Price'),
        h('input', { type: 'number', step: '0.01', min: '0', value: price(), oninput: (e) => price(+e.target.value), style: inputStyle }),
      ),
      h('div', {},
        h('label', { style: labelStyle }, 'Quantity'),
        h('input', { type: 'number', min: '1', value: quantity(), oninput: (e) => quantity(+e.target.value || 1), style: inputStyle }),
      ),
      h('div', {},
        h('label', { style: labelStyle }, 'Tax Rate'),
        h('select', {
          value: taxRate(),
          onchange: (e) => taxRate(+e.target.value),
          style: inputStyle,
        },
          h('option', { value: '0' }, 'No Tax'),
          h('option', { value: '0.05' }, '5%'),
          h('option', { value: '0.08' }, '8%'),
          h('option', { value: '0.10' }, '10%'),
        ),
      ),
      h('div', {},
        h('label', { style: labelStyle }, 'Coupon Code'),
        h('input', { type: 'text', placeholder: 'Try SAVE10 or SAVE20', value: coupon(), oninput: (e) => coupon(e.target.value.toUpperCase()), style: inputStyle }),
      ),
    ),
    // Results
    h('div', { style: 'background: #1a1a2e; border-radius: 12px; padding: 20px;' },
      h('div', { style: 'display: flex; justify-content: space-between; padding: 8px 0; color: #aaa;' },
        h('span', {}, 'Subtotal'),
        h('span', {}, () => fmt(subtotal())),
      ),
      () => discount() > 0
        ? h('div', { style: 'display: flex; justify-content: space-between; padding: 8px 0; color: #22c55e;' },
            h('span', {}, 'Discount'),
            h('span', {}, () => '-' + fmt(discount())),
          )
        : null,
      h('div', { style: 'display: flex; justify-content: space-between; padding: 8px 0; color: #aaa;' },
        h('span', {}, 'Tax'),
        h('span', {}, () => fmt(tax())),
      ),
      h('div', { style: 'display: flex; justify-content: space-between; padding: 12px 0; border-top: 1px solid #333; margin-top: 8px; font-size: 20px; font-weight: 600;' },
        h('span', {}, 'Total'),
        h('span', { style: 'color: #8b5cf6;' }, () => fmt(total())),
      ),
    ),
  );
}

mount(h(PriceCalculator), '#app');
`,
  },
  {
    id: 'effects',
    title: 'Effects',
    description: 'effect() with auto-tracking and cleanup',
    code: `import { signal, effect, h, mount } from 'what-framework';

function EffectDemo() {
  const count = signal(0, 'count');
  const color = signal('#8b5cf6', 'color');
  const logs = signal([], 'logs');

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString();
    logs(prev => [...prev.slice(-8), \`[\${time}] \${msg}\`]);
  };

  // effect() auto-tracks — no dependency array needed!
  effect(() => {
    addLog(\`Count changed to \${count()}\`);
  });

  effect(() => {
    addLog(\`Color changed to \${color()}\`);
    // Set document title as side effect
    document.title = \`Count: \${count()}\`;
  });

  // Effect with interval (cleanup on disposal)
  const ticking = signal(false, 'ticking');
  let interval = null;

  effect(() => {
    if (ticking()) {
      interval = setInterval(() => {
        count(c => c + 1);
      }, 1000);
      addLog('Timer started');
    } else {
      if (interval) {
        clearInterval(interval);
        interval = null;
        addLog('Timer stopped');
      }
    }
  });

  return h('div', { style: 'max-width: 500px; margin: 0 auto;' },
    h('h2', {}, 'Effects'),
    h('p', { style: 'color: #888; margin-bottom: 20px;' },
      'effect() auto-tracks signal dependencies. No arrays needed.'
    ),
    // Controls
    h('div', { style: 'display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px;' },
      h('button', {
        onclick: () => count(c => c + 1),
        style: 'padding: 8px 20px; border-radius: 8px; border: 1px solid #8b5cf6; background: #8b5cf6; color: #fff; cursor: pointer;',
      }, () => \`Increment (\${count()})\`),
      h('button', {
        onclick: () => ticking(t => !t),
        style: () => \`padding: 8px 20px; border-radius: 8px; border: 1px solid \${ticking() ? '#ef4444' : '#22c55e'}; background: \${ticking() ? '#ef4444' : '#22c55e'}; color: #fff; cursor: pointer;\`,
      }, () => ticking() ? 'Stop Timer' : 'Start Timer'),
      h('input', {
        type: 'color',
        value: color(),
        oninput: (e) => color(e.target.value),
        style: 'width: 44px; height: 38px; border: none; background: none; cursor: pointer;',
      }),
    ),
    // Preview
    h('div', {
      style: () => \`width: 100%; height: 80px; border-radius: 12px; background: \${color()}; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 700; color: #fff; margin-bottom: 20px; transition: background 0.3s;\`,
    }, () => count()),
    // Effect log
    h('div', { style: 'background: #0d0d1a; border-radius: 8px; padding: 16px; font-family: monospace; font-size: 13px;' },
      h('div', { style: 'color: #666; margin-bottom: 8px;' }, 'Effect Log:'),
      () => h('div', {},
        ...logs().map(log =>
          h('div', { style: 'color: #aaa; padding: 2px 0;' }, log)
        ),
      ),
    ),
  );
}

mount(h(EffectDemo), '#app');
`,
  },
  {
    id: 'two-way-binding',
    title: 'Two-Way Binding',
    description: 'Form inputs with signals',
    code: `import { signal, computed, h, mount } from 'what-framework';

function FormDemo() {
  const name = signal('', 'name');
  const email = signal('', 'email');
  const role = signal('developer', 'role');
  const newsletter = signal(true, 'newsletter');
  const bio = signal('', 'bio');
  const submitted = signal(false, 'submitted');

  const isValid = computed(() =>
    name().trim().length > 0 && email().includes('@')
  );

  const charCount = computed(() => bio().length);

  const handleSubmit = () => {
    if (!isValid()) return;
    submitted(true);
    console.log('Form submitted:', {
      name: name(), email: email(),
      role: role(), newsletter: newsletter(),
      bio: bio(),
    });
  };

  const inputStyle = 'width: 100%; padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px;';
  const labelStyle = 'display: block; color: #aaa; font-size: 13px; margin-bottom: 6px;';

  return h('div', { style: 'max-width: 480px; margin: 0 auto;' },
    h('h2', {}, 'Profile Form'),
    h('p', { style: 'color: #888; margin-bottom: 20px;' },
      'Signals bind directly to inputs. No controlled/uncontrolled distinction.'
    ),
    () => submitted()
      ? h('div', { style: 'background: #1a2e1a; border: 1px solid #22c55e; border-radius: 12px; padding: 24px; text-align: center;' },
          h('div', { style: 'font-size: 48px; margin-bottom: 12px;' }, '\\u2713'),
          h('h3', { style: 'color: #22c55e; margin-bottom: 8px;' }, 'Submitted!'),
          h('p', { style: 'color: #aaa;' }, () => \`Welcome, \${name()}!\`),
          h('button', {
            onclick: () => submitted(false),
            style: 'margin-top: 16px; padding: 8px 24px; border-radius: 8px; border: 1px solid #444; background: transparent; color: #eee; cursor: pointer;',
          }, 'Edit'),
        )
      : h('div', { style: 'display: grid; gap: 16px;' },
          h('div', {},
            h('label', { style: labelStyle }, 'Name *'),
            h('input', { type: 'text', value: name(), oninput: (e) => name(e.target.value), placeholder: 'Your name', style: inputStyle }),
          ),
          h('div', {},
            h('label', { style: labelStyle }, 'Email *'),
            h('input', { type: 'email', value: email(), oninput: (e) => email(e.target.value), placeholder: 'you@example.com', style: inputStyle }),
          ),
          h('div', {},
            h('label', { style: labelStyle }, 'Role'),
            h('select', { value: role(), onchange: (e) => role(e.target.value), style: inputStyle },
              h('option', { value: 'developer' }, 'Developer'),
              h('option', { value: 'designer' }, 'Designer'),
              h('option', { value: 'manager' }, 'Manager'),
              h('option', { value: 'other' }, 'Other'),
            ),
          ),
          h('div', {},
            h('label', { style: labelStyle }, () => \`Bio (\${charCount()}/200)\`),
            h('textarea', {
              rows: 3,
              maxlength: 200,
              value: bio(),
              oninput: (e) => bio(e.target.value),
              placeholder: 'Tell us about yourself...',
              style: inputStyle + ' resize: vertical; min-height: 80px;',
            }),
          ),
          h('label', { style: 'display: flex; align-items: center; gap: 10px; cursor: pointer;' },
            h('input', { type: 'checkbox', checked: newsletter(), onchange: (e) => newsletter(e.target.checked), style: 'width: 18px; height: 18px; accent-color: #8b5cf6;' }),
            h('span', { style: 'color: #aaa; font-size: 14px;' }, 'Subscribe to newsletter'),
          ),
          // Live preview card
          h('div', { style: 'background: #1a1a2e; border-radius: 12px; padding: 16px; margin-top: 8px;' },
            h('div', { style: 'font-size: 13px; color: #666; margin-bottom: 8px;' }, 'Live Preview'),
            h('div', { style: 'font-weight: 600;' }, () => name() || 'Your Name'),
            h('div', { style: 'color: #888; font-size: 14px;' }, () => email() || 'email@example.com'),
            h('div', { style: 'color: #8b5cf6; font-size: 13px; margin-top: 4px;' }, () => role()),
          ),
          h('button', {
            onclick: handleSubmit,
            disabled: () => !isValid(),
            style: () => \`width: 100%; padding: 12px; border-radius: 8px; border: none; background: \${isValid() ? '#8b5cf6' : '#333'}; color: \${isValid() ? '#fff' : '#666'}; font-size: 16px; cursor: \${isValid() ? 'pointer' : 'not-allowed'}; font-weight: 500; transition: all 0.2s;\`,
          }, 'Submit'),
        ),
  );
}

mount(h(FormDemo), '#app');
`,
  },
  {
    id: 'fetch-data',
    title: 'Fetch Data',
    description: 'Async data loading with signals',
    code: `import { signal, effect, h, mount } from 'what-framework';

function UserBrowser() {
  const users = signal([], 'users');
  const loading = signal(true, 'loading');
  const error = signal(null, 'error');
  const selected = signal(null, 'selected');
  const search = signal('', 'search');

  // Fetch users on mount
  async function fetchUsers() {
    loading(true);
    error(null);
    try {
      const res = await fetch('https://jsonplaceholder.typicode.com/users');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      users(data);
    } catch (e) {
      error(e.message);
    } finally {
      loading(false);
    }
  }

  fetchUsers();

  const filtered = () => {
    const q = search().toLowerCase();
    return q
      ? users().filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
      : users();
  };

  return h('div', { style: 'max-width: 600px; margin: 0 auto;' },
    h('h2', {}, 'User Directory'),
    h('div', { style: 'display: flex; gap: 8px; margin: 16px 0;' },
      h('input', {
        type: 'text',
        placeholder: 'Search users...',
        oninput: (e) => search(e.target.value),
        style: 'flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px;',
      }),
      h('button', {
        onclick: fetchUsers,
        style: 'padding: 10px 16px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; cursor: pointer;',
      }, 'Refresh'),
    ),
    // Content
    () => {
      if (loading()) {
        return h('div', { style: 'text-align: center; padding: 48px; color: #888;' },
          h('div', { style: 'font-size: 24px; animation: spin 1s linear infinite; display: inline-block;' }, '\\u21bb'),
          h('p', { style: 'margin-top: 12px;' }, 'Loading users...'),
        );
      }
      if (error()) {
        return h('div', { style: 'background: #2e1a1a; border: 1px solid #ef4444; border-radius: 12px; padding: 24px; text-align: center;' },
          h('p', { style: 'color: #ef4444;' }, () => \`Error: \${error()}\`),
          h('button', {
            onclick: fetchUsers,
            style: 'margin-top: 12px; padding: 8px 20px; border-radius: 8px; border: 1px solid #ef4444; background: transparent; color: #ef4444; cursor: pointer;',
          }, 'Retry'),
        );
      }
      const list = filtered();
      if (list.length === 0) {
        return h('p', { style: 'text-align: center; padding: 32px; color: #666;' }, 'No users found.');
      }
      return h('div', { style: 'display: grid; gap: 8px;' },
        ...list.map(user =>
          h('div', {
            key: user.id,
            onclick: () => selected(selected() === user.id ? null : user.id),
            style: \`padding: 14px 16px; border-radius: 10px; background: \${selected() === user.id ? '#1e1b4b' : '#1a1a2e'}; border: 1px solid \${selected() === user.id ? '#8b5cf6' : 'transparent'}; cursor: pointer; transition: all 0.2s;\`,
          },
            h('div', { style: 'display: flex; justify-content: space-between; align-items: center;' },
              h('div', {},
                h('div', { style: 'font-weight: 600;' }, user.name),
                h('div', { style: 'color: #888; font-size: 13px;' }, user.email),
              ),
              h('div', { style: 'color: #8b5cf6; font-size: 13px;' }, user.company.name),
            ),
            selected() === user.id
              ? h('div', { style: 'margin-top: 12px; padding-top: 12px; border-top: 1px solid #333; display: grid; gap: 6px; font-size: 13px; color: #aaa;' },
                  h('div', {}, '\\ud83c\\udf10 ', user.website),
                  h('div', {}, '\\ud83d\\udcde ', user.phone),
                  h('div', {}, '\\ud83d\\udccd ', \`\${user.address.city}, \${user.address.street}\`),
                )
              : null,
          ),
        ),
      );
    },
  );
}

mount(h(UserBrowser), '#app');
`,
  },
  {
    id: 'component-composition',
    title: 'Component Composition',
    description: 'Parent/child components with props',
    code: `import { signal, h, mount } from 'what-framework';

// Child component — receives props, manages local state
function Card({ title, color, children }) {
  const expanded = signal(true, 'expanded');

  return h('div', {
    style: \`border-radius: 12px; border: 1px solid #333; overflow: hidden; margin-bottom: 12px;\`,
  },
    h('div', {
      onclick: () => expanded(e => !e),
      style: \`padding: 14px 18px; background: \${color}15; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;\`,
    },
      h('span', { style: \`font-weight: 600; color: \${color};\` }, title),
      h('span', { style: 'color: #666; transition: transform 0.2s;' },
        () => expanded() ? '\\u25bc' : '\\u25b6'
      ),
    ),
    () => expanded()
      ? h('div', { style: 'padding: 18px;' }, children)
      : null,
  );
}

// Reusable stat display
function Stat({ label, value, trend }) {
  const trendColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#888';
  const trendIcon = trend === 'up' ? '\\u2191' : trend === 'down' ? '\\u2193' : '\\u2192';

  return h('div', { style: 'text-align: center;' },
    h('div', { style: 'font-size: 28px; font-weight: 700;' }, value),
    h('div', { style: 'color: #888; font-size: 13px; margin-top: 4px;' }, label),
    h('div', { style: \`color: \${trendColor}; font-size: 13px; margin-top: 2px;\` }, trendIcon),
  );
}

// Tag component
function Tag({ label, color }) {
  return h('span', {
    style: \`display: inline-block; padding: 4px 12px; border-radius: 999px; background: \${color}20; color: \${color}; font-size: 12px; font-weight: 500;\`,
  }, label);
}

// Parent component composes children
function Dashboard() {
  const activeTab = signal('overview', 'activeTab');

  return h('div', { style: 'max-width: 600px; margin: 0 auto;' },
    h('h2', {}, 'Dashboard'),
    h('p', { style: 'color: #888; margin-bottom: 20px;' },
      'Components compose naturally. Each manages its own state.'
    ),

    h(Card, { title: 'Statistics', color: '#8b5cf6' },
      h('div', { style: 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;' },
        h(Stat, { label: 'Users', value: '2,847', trend: 'up' }),
        h(Stat, { label: 'Revenue', value: '$12.4k', trend: 'up' }),
        h(Stat, { label: 'Bounce', value: '24%', trend: 'down' }),
      ),
    ),

    h(Card, { title: 'Tech Stack', color: '#3b82f6' },
      h('div', { style: 'display: flex; flex-wrap: wrap; gap: 8px;' },
        h(Tag, { label: 'Signals', color: '#8b5cf6' }),
        h(Tag, { label: 'No VDOM', color: '#22c55e' }),
        h(Tag, { label: 'Run Once', color: '#3b82f6' }),
        h(Tag, { label: 'Fine-grained', color: '#f59e0b' }),
        h(Tag, { label: 'Zero config', color: '#ef4444' }),
        h(Tag, { label: '< 5kb', color: '#06b6d4' }),
      ),
    ),

    h(Card, { title: 'Recent Activity', color: '#22c55e' },
      h('div', { style: 'display: grid; gap: 12px;' },
        ...['Deployed v2.1.0', 'Fixed auth bug', 'Added dark mode', 'Updated deps'].map((item, i) =>
          h('div', { style: 'display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222;' },
            h('span', {}, item),
            h('span', { style: 'color: #666; font-size: 13px;' }, \`\${i + 1}h ago\`),
          ),
        ),
      ),
    ),
  );
}

mount(h(Dashboard), '#app');
`,
  },
  {
    id: 'animations',
    title: 'Animations',
    description: 'Spring and tween animations',
    code: `import { signal, effect, h, mount } from 'what-framework';

function AnimationDemo() {
  // Manual spring implementation (no framework import needed)
  function useSpring(initial, opts = {}) {
    const { stiffness = 120, damping = 14, mass = 1 } = opts;
    const current = signal(initial);
    const target = signal(initial);
    const velocity = signal(0);
    let raf = null, lastT = null;

    function tick(time) {
      if (!lastT) { lastT = time; raf = requestAnimationFrame(tick); return; }
      const dt = Math.min((time - lastT) / 1000, 0.064);
      lastT = time;
      const c = current(), tgt = target(), v = velocity();
      const disp = c - tgt;
      const acc = (-stiffness * disp - damping * v) / mass;
      const nv = v + acc * dt;
      const nc = c + nv * dt;
      current(nc); velocity(nv);
      if (Math.abs(nv) < 0.01 && Math.abs(disp) < 0.01) {
        current(tgt); velocity(0); raf = null; lastT = null; return;
      }
      raf = requestAnimationFrame(tick);
    }

    return {
      value: current,
      set(v) { target(v); if (!raf) { lastT = null; raf = requestAnimationFrame(tick); } },
    };
  }

  const x = useSpring(0);
  const y = useSpring(0);
  const scale = useSpring(1, { stiffness: 200, damping: 12 });
  const rotation = useSpring(0, { stiffness: 80, damping: 10 });
  const hue = useSpring(260, { stiffness: 60, damping: 15 });
  const borderRadius = useSpring(16);

  const isHovering = signal(false);

  const randomize = () => {
    x.set((Math.random() - 0.5) * 200);
    y.set((Math.random() - 0.5) * 150);
    rotation.set(Math.random() * 360);
    hue.set(Math.random() * 360);
    borderRadius.set(Math.random() * 50);
  };

  const reset = () => {
    x.set(0); y.set(0); scale.set(1);
    rotation.set(0); hue.set(260); borderRadius.set(16);
  };

  return h('div', { style: 'max-width: 600px; margin: 0 auto; text-align: center;' },
    h('h2', {}, 'Spring Animations'),
    h('p', { style: 'color: #888; margin-bottom: 24px;' },
      'Physics-based springs. Move your mouse over the box.'
    ),
    // Animated box container
    h('div', {
      style: 'height: 300px; display: flex; align-items: center; justify-content: center; background: #0d0d1a; border-radius: 16px; margin-bottom: 24px; overflow: hidden; position: relative;',
      onmousemove: (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        x.set(mx * 0.3);
        y.set(my * 0.3);
      },
      onmouseenter: () => { isHovering(true); scale.set(1.15); },
      onmouseleave: () => { isHovering(false); scale.set(1); x.set(0); y.set(0); },
    },
      h('div', {
        style: () => \`width: 120px; height: 120px; border-radius: \${borderRadius.value()}px; background: hsl(\${hue.value()}, 70%, 60%); transform: translate(\${x.value()}px, \${y.value()}px) scale(\${scale.value()}) rotate(\${rotation.value()}deg); transition: box-shadow 0.3s; box-shadow: 0 0 \${isHovering() ? '40' : '20'}px hsl(\${hue.value()}, 70%, 60%, 0.4);\`,
      }),
    ),
    // Controls
    h('div', { style: 'display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;' },
      h('button', {
        onclick: randomize,
        style: 'padding: 10px 24px; border-radius: 8px; border: none; background: #8b5cf6; color: #fff; font-size: 14px; cursor: pointer;',
      }, 'Randomize'),
      h('button', {
        onclick: reset,
        style: 'padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: transparent; color: #eee; font-size: 14px; cursor: pointer;',
      }, 'Reset'),
      h('button', {
        onclick: () => {
          hue.set((Math.random() * 360));
          borderRadius.set(borderRadius.value() > 30 ? 4 : 60);
        },
        style: 'padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: transparent; color: #eee; font-size: 14px; cursor: pointer;',
      }, 'Morph'),
    ),
    // Spring values
    h('div', { style: 'margin-top: 20px; font-family: monospace; font-size: 12px; color: #666;' },
      () => \`x: \${x.value().toFixed(1)}  y: \${y.value().toFixed(1)}  scale: \${scale.value().toFixed(2)}  rotation: \${rotation.value().toFixed(0)}deg\`,
    ),
  );
}

mount(h(AnimationDemo), '#app');
`,
  },
  {
    id: 'theme-switcher',
    title: 'Theme Switcher',
    description: 'Reactive CSS and styling',
    code: `import { signal, computed, effect, h, mount } from 'what-framework';

function ThemeSwitcher() {
  const themes = {
    midnight: { bg: '#0a0a1a', surface: '#12122a', accent: '#8b5cf6', text: '#e4e4f0', muted: '#6b6b8a', name: 'Midnight' },
    forest:   { bg: '#0a1a0d', surface: '#122a16', accent: '#22c55e', text: '#e4f0e6', muted: '#6b8a6e', name: 'Forest' },
    ocean:    { bg: '#0a141a', surface: '#12242a', accent: '#3b82f6', text: '#e4ecf0', muted: '#6b7f8a', name: 'Ocean' },
    sunset:   { bg: '#1a0f0a', surface: '#2a1912', accent: '#f59e0b', text: '#f0ece4', muted: '#8a7d6b', name: 'Sunset' },
    rose:     { bg: '#1a0a14', surface: '#2a1222', accent: '#ec4899', text: '#f0e4ec', muted: '#8a6b7f', name: 'Rose' },
  };

  const current = signal('midnight', 'theme');
  const fontSize = signal(16, 'fontSize');
  const spacing = signal(16, 'spacing');
  const radius = signal(12, 'radius');

  const theme = computed(() => themes[current()]);

  return h('div', {
    style: () => \`min-height: 100vh; background: \${theme().bg}; color: \${theme().text}; padding: \${spacing() * 2}px; font-size: \${fontSize()}px; transition: all 0.4s ease;\`,
  },
    h('div', { style: 'max-width: 560px; margin: 0 auto;' },
      h('h2', { style: () => \`color: \${theme().accent};\` }, 'Theme Switcher'),
      h('p', { style: () => \`color: \${theme().muted}; margin-bottom: 24px;\` },
        'Signals drive CSS. Every change is surgically applied to the DOM.'
      ),

      // Theme selector
      h('div', { style: () => \`display: flex; gap: \${spacing() / 2}px; margin-bottom: \${spacing() * 1.5}px; flex-wrap: wrap;\` },
        ...Object.entries(themes).map(([key, t]) =>
          h('button', {
            onclick: () => current(key),
            style: () => \`padding: 10px 18px; border-radius: \${radius()}px; border: 2px solid \${current() === key ? t.accent : 'transparent'}; background: \${t.surface}; color: \${t.accent}; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.3s;\`,
          }, t.name),
        ),
      ),

      // Controls
      h('div', {
        style: () => \`background: \${theme().surface}; border-radius: \${radius()}px; padding: \${spacing()}px; margin-bottom: \${spacing()}px;\`,
      },
        h('div', { style: 'margin-bottom: 16px;' },
          h('label', { style: () => \`color: \${theme().muted}; font-size: 13px; display: block; margin-bottom: 6px;\` },
            () => \`Font Size: \${fontSize()}px\`,
          ),
          h('input', {
            type: 'range', min: 12, max: 24, value: fontSize(),
            oninput: (e) => fontSize(+e.target.value),
            style: () => \`width: 100%; accent-color: \${theme().accent};\`,
          }),
        ),
        h('div', { style: 'margin-bottom: 16px;' },
          h('label', { style: () => \`color: \${theme().muted}; font-size: 13px; display: block; margin-bottom: 6px;\` },
            () => \`Spacing: \${spacing()}px\`,
          ),
          h('input', {
            type: 'range', min: 8, max: 32, value: spacing(),
            oninput: (e) => spacing(+e.target.value),
            style: () => \`width: 100%; accent-color: \${theme().accent};\`,
          }),
        ),
        h('div', {},
          h('label', { style: () => \`color: \${theme().muted}; font-size: 13px; display: block; margin-bottom: 6px;\` },
            () => \`Border Radius: \${radius()}px\`,
          ),
          h('input', {
            type: 'range', min: 0, max: 24, value: radius(),
            oninput: (e) => radius(+e.target.value),
            style: () => \`width: 100%; accent-color: \${theme().accent};\`,
          }),
        ),
      ),

      // Preview cards
      h('div', { style: () => \`display: grid; grid-template-columns: 1fr 1fr; gap: \${spacing()}px;\` },
        ...['Primary Card', 'Secondary Card', 'Status: Active', 'Notifications: 3'].map((label, i) =>
          h('div', {
            style: () => \`background: \${theme().surface}; border-radius: \${radius()}px; padding: \${spacing()}px; border-left: 3px solid \${theme().accent};\`,
          },
            h('div', { style: 'font-weight: 600; margin-bottom: 6px;' }, label),
            h('div', { style: () => \`color: \${theme().muted}; font-size: 13px;\` },
              'Every property is reactive'
            ),
          ),
        ),
      ),

      // Code output
      h('pre', {
        style: () => \`margin-top: \${spacing()}px; background: \${theme().surface}; border-radius: \${radius()}px; padding: \${spacing()}px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: \${theme().muted}; overflow-x: auto;\`,
      },
        () => \`theme: "\${current()}"\\nfontSize: \${fontSize()}px\\nspacing: \${spacing()}px\\nradius: \${radius()}px\\naccent: "\${theme().accent}"\`,
      ),
    ),
  );
}

mount(h(ThemeSwitcher), '#app');
`,
  },
  {
    id: 'stopwatch',
    title: 'Stopwatch',
    description: 'Precise timing with signals',
    code: `import { signal, computed, h, mount } from 'what-framework';

function Stopwatch() {
  const elapsed = signal(0, 'elapsed');
  const running = signal(false, 'running');
  const laps = signal([], 'laps');
  let interval = null;
  let startTime = 0;
  let accumulated = 0;

  const formatted = computed(() => {
    const ms = elapsed();
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const centis = Math.floor((ms % 1000) / 10);
    return \`\${String(minutes).padStart(2, '0')}:\${String(seconds).padStart(2, '0')}.\${String(centis).padStart(2, '0')}\`;
  });

  const formatMs = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const c = Math.floor((ms % 1000) / 10);
    return \`\${String(m).padStart(2, '0')}:\${String(s).padStart(2, '0')}.\${String(c).padStart(2, '0')}\`;
  };

  const start = () => {
    if (running()) return;
    running(true);
    startTime = performance.now();
    interval = setInterval(() => {
      elapsed(accumulated + (performance.now() - startTime));
    }, 16);
  };

  const stop = () => {
    if (!running()) return;
    running(false);
    accumulated += performance.now() - startTime;
    clearInterval(interval);
  };

  const reset = () => {
    stop();
    elapsed(0);
    accumulated = 0;
    laps([]);
  };

  const lap = () => {
    if (!running()) return;
    const prev = laps().length > 0 ? laps()[laps().length - 1].total : 0;
    laps(prev => [...prev, { id: prev.length + 1, total: elapsed(), split: elapsed() - (prev.length > 0 ? prev[prev.length - 1].total : 0) }]);
  };

  const bestLap = computed(() => {
    const l = laps();
    if (l.length < 2) return -1;
    let best = 0;
    for (let i = 1; i < l.length; i++) {
      if (l[i].split < l[best].split) best = i;
    }
    return l[best].id;
  });

  const worstLap = computed(() => {
    const l = laps();
    if (l.length < 2) return -1;
    let worst = 0;
    for (let i = 1; i < l.length; i++) {
      if (l[i].split > l[worst].split) worst = i;
    }
    return l[worst].id;
  });

  const btnBase = 'padding: 12px 28px; border-radius: 999px; border: none; font-size: 15px; font-weight: 500; cursor: pointer;';

  return h('div', { style: 'max-width: 400px; margin: 0 auto; text-align: center;' },
    h('h2', { style: 'margin-bottom: 32px;' }, 'Stopwatch'),
    // Time display
    h('div', {
      style: 'font-size: 64px; font-weight: 200; font-variant-numeric: tabular-nums; font-family: "JetBrains Mono", monospace; letter-spacing: 2px; margin-bottom: 32px;',
    }, () => formatted()),
    // Progress ring
    h('div', {
      style: () => \`width: 8px; height: 8px; border-radius: 50%; margin: 0 auto 24px; background: \${running() ? '#22c55e' : elapsed() > 0 ? '#f59e0b' : '#444'}; box-shadow: 0 0 \${running() ? '12px #22c55e' : '0px transparent'}; transition: all 0.3s;\`,
    }),
    // Buttons
    h('div', { style: 'display: flex; gap: 12px; justify-content: center; margin-bottom: 32px;' },
      () => !running()
        ? h('button', {
            onclick: start,
            style: btnBase + ' background: #22c55e; color: #fff;',
          }, elapsed() > 0 ? 'Resume' : 'Start')
        : h('button', {
            onclick: stop,
            style: btnBase + ' background: #ef4444; color: #fff;',
          }, 'Stop'),
      h('button', {
        onclick: running() ? lap : reset,
        disabled: () => !running() && elapsed() === 0,
        style: () => \`\${btnBase} background: #333; color: \${!running() && elapsed() === 0 ? '#555' : '#eee'};\`,
      }, () => running() ? 'Lap' : 'Reset'),
    ),
    // Laps
    () => laps().length > 0
      ? h('div', { style: 'text-align: left; background: #1a1a2e; border-radius: 12px; overflow: hidden;' },
          h('div', { style: 'padding: 12px 16px; font-size: 13px; color: #666; border-bottom: 1px solid #333; display: flex; justify-content: space-between;' },
            h('span', {}, 'Lap'),
            h('span', {}, 'Split'),
            h('span', {}, 'Total'),
          ),
          ...laps().slice().reverse().map(l =>
            h('div', {
              key: l.id,
              style: \`padding: 10px 16px; border-bottom: 1px solid #222; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; color: \${l.id === bestLap() ? '#22c55e' : l.id === worstLap() ? '#ef4444' : '#ccc'};\`,
            },
              h('span', { style: 'color: #666;' }, \`Lap \${l.id}\`),
              h('span', {}, formatMs(l.split)),
              h('span', { style: 'color: #888;' }, formatMs(l.total)),
            ),
          ),
        )
      : null,
  );
}

mount(h(Stopwatch), '#app');
`,
  },
  {
    id: 'markdown-preview',
    title: 'Markdown Preview',
    description: 'Live text transformation with signals',
    code: `import { signal, computed, h, mount } from 'what-framework';

function MarkdownPreview() {
  const input = signal(\`# Hello What Framework!

This is a **live markdown preview** powered by signals.

## Features
- *Italic text* and **bold text**
- Code: \\\`signal()\\\`, \\\`computed()\\\`, \\\`effect()\\\`
- Links and more

### How it works
The input is a signal. The preview is a computed value.
Every keystroke updates \\u2014 but **only the preview DOM node changes**.

> Components run once. Signals do the rest.

---

Try editing this text!\`, 'markdown');

  // Minimal markdown parser (no library needed)
  const rendered = computed(() => {
    let html = input()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headings
      .replace(/^### (.+)$/gm, '<h3 style="margin: 16px 0 8px; font-size: 16px;">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="margin: 20px 0 8px; font-size: 20px;">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="margin: 20px 0 12px; font-size: 26px;">$1</h1>')
      // Horizontal rule
      .replace(/^---$/gm, '<hr style="border: none; border-top: 1px solid #333; margin: 16px 0;">')
      // Bold & italic
      .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*(.+?)\\*/g, '<em style="color: #a78bfa;">$1</em>')
      // Code
      .replace(/\\\`(.+?)\\\`/g, '<code style="background: #1e1b4b; padding: 2px 6px; border-radius: 4px; font-family: monospace; color: #8b5cf6;">$1</code>')
      // Blockquote
      .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left: 3px solid #8b5cf6; padding-left: 16px; color: #aaa; margin: 12px 0;">$1</blockquote>')
      // Lists
      .replace(/^- (.+)$/gm, '<div style="padding: 2px 0 2px 16px;">\\u2022 $1</div>')
      // Paragraphs
      .replace(/\\n\\n/g, '<br><br>');
    return html;
  });

  const wordCount = computed(() => {
    const text = input().trim();
    return text ? text.split(/\\s+/).length : 0;
  });

  const charCount = computed(() => input().length);

  return h('div', { style: 'max-width: 900px; margin: 0 auto;' },
    h('h2', {}, 'Markdown Preview'),
    h('div', { style: 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;' },
      // Editor
      h('div', {},
        h('div', { style: 'color: #666; font-size: 13px; margin-bottom: 8px; display: flex; justify-content: space-between;' },
          h('span', {}, 'Markdown'),
          h('span', {}, () => \`\${wordCount()} words, \${charCount()} chars\`),
        ),
        h('textarea', {
          value: input(),
          oninput: (e) => input(e.target.value),
          style: 'width: 100%; height: 500px; padding: 16px; border-radius: 12px; border: 1px solid #333; background: #0d0d1a; color: #ddd; font-family: "JetBrains Mono", monospace; font-size: 14px; line-height: 1.6; resize: none;',
        }),
      ),
      // Preview
      h('div', {},
        h('div', { style: 'color: #666; font-size: 13px; margin-bottom: 8px;' }, 'Preview'),
        h('div', {
          style: 'height: 500px; overflow-y: auto; padding: 16px; border-radius: 12px; border: 1px solid #333; background: #12121e; line-height: 1.7;',
          dangerouslySetInnerHTML: () => ({ __html: rendered() }),
        }),
      ),
    ),
  );
}

mount(h(MarkdownPreview), '#app');
`,
  },
];
