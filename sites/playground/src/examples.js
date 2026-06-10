// What Framework Playground — Example Code Snippets
// All examples are idiomatic JSX. The playground compiles them in-browser
// with the real what-compiler (see compile.worker.js) before running them in
// the preview iframe. Use the "Compiled output" toggle to see the generated
// JavaScript.

export const examples = [
  {
    id: 'hello-world',
    title: 'Hello World',
    description: 'Minimal signal + rendering',
    code: `import { signal, mount } from 'what-framework';

// Signals are reactive values — read with (), write with (newVal)
const name = signal('World', 'name');

function HelloWorld() {
  return (
    <div class="hello">
      <h1>Hello, {name()}!</h1>
      <input
        type="text"
        value={name()}
        placeholder="Type your name..."
        onInput={(e) => name(e.target.value)}
        style="padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 16px; width: 250px; margin-top: 16px;"
      />
      <p style="margin-top: 12px; color: #888;">
        Components run ONCE. Only the text updates.
      </p>
    </div>
  );
}

mount(<HelloWorld />, '#app');
`,
  },
  {
    id: 'counter',
    title: 'Counter',
    description: 'Signal read/write with buttons',
    code: `import { signal, mount } from 'what-framework';

function Counter() {
  const count = signal(0, 'count');

  return (
    <div style="text-align: center;">
      <h2>Counter</h2>
      <div style="font-size: 72px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 24px 0;">
        {count()}
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button
          onClick={() => count(c => c - 1)}
          style="padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 18px; cursor: pointer;"
        >
          - 1
        </button>
        <button
          onClick={() => count(0)}
          style="padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: #333; color: #eee; font-size: 18px; cursor: pointer;"
        >
          Reset
        </button>
        <button
          onClick={() => count(c => c + 1)}
          style="padding: 10px 24px; border-radius: 8px; border: 1px solid #8b5cf6; background: #8b5cf6; color: #fff; font-size: 18px; cursor: pointer;"
        >
          + 1
        </button>
      </div>
      <p style="margin-top: 16px; color: #888;">
        The count is {count() === 0 ? 'zero' : count() > 0 ? 'positive' : 'negative'}
      </p>
    </div>
  );
}

mount(<Counter />, '#app');
`,
  },
  {
    id: 'todo-list',
    title: 'Todo List',
    description: 'Signals + dynamic list rendering',
    code: `import { signal, computed, mount } from 'what-framework';

function TodoApp() {
  // Each todo carries its own done signal — toggling one
  // updates that row in place, no list re-render.
  const todos = signal([], 'todos');
  const input = signal('', 'input');
  const filter = signal('all', 'filter');

  const filteredTodos = computed(() => {
    const list = todos();
    const f = filter();
    if (f === 'active') return list.filter(t => !t.done());
    if (f === 'completed') return list.filter(t => t.done());
    return list;
  });

  const remaining = computed(() =>
    todos().filter(t => !t.done()).length
  );

  const addTodo = () => {
    const text = input().trim();
    if (!text) return;
    todos(prev => [...prev, { id: Date.now(), text, done: signal(false) }]);
    input('');
  };

  const remove = (id) => {
    todos(prev => prev.filter(t => t.id !== id));
  };

  const btnStyle = (active) =>
    \`padding: 6px 14px; border-radius: 6px; border: 1px solid \${active ? '#8b5cf6' : '#444'}; background: \${active ? '#8b5cf6' : 'transparent'}; color: \${active ? '#fff' : '#aaa'}; cursor: pointer; font-size: 13px;\`;

  return (
    <div style="max-width: 480px; margin: 0 auto;">
      <h2>Todo List</h2>

      <div style="display: flex; gap: 8px; margin: 16px 0;">
        <input
          type="text"
          value={input()}
          placeholder="What needs to be done?"
          onInput={(e) => input(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addTodo()}
          style="flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px;"
        />
        <button
          onClick={addTodo}
          style="padding: 10px 20px; border-radius: 8px; border: none; background: #8b5cf6; color: #fff; font-size: 14px; cursor: pointer;"
        >
          Add
        </button>
      </div>

      <div style="display: flex; gap: 8px; margin-bottom: 16px;">
        <button onClick={() => filter('all')} style={btnStyle(filter() === 'all')}>All</button>
        <button onClick={() => filter('active')} style={btnStyle(filter() === 'active')}>Active</button>
        <button onClick={() => filter('completed')} style={btnStyle(filter() === 'completed')}>Completed</button>
      </div>

      <div>
        {filteredTodos().length === 0
          ? <p style="color: #666; text-align: center; padding: 32px;">No todos yet. Add one above!</p>
          : <div>
              {filteredTodos().map(todo => (
                <div
                  key={todo.id}
                  style="display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 8px; margin-bottom: 4px; background: #1a1a2e;"
                >
                  <input
                    type="checkbox"
                    checked={() => todo.done()}
                    onChange={() => todo.done(d => !d)}
                    style="width: 18px; height: 18px; accent-color: #8b5cf6; cursor: pointer;"
                  />
                  {/* todo.done is a per-item signal, so wrap reads in a
                      function for a fine-grained binding */}
                  <span style={() => \`flex: 1; \${todo.done() ? 'text-decoration: line-through; color: #666;' : ''}\`}>
                    {todo.text}
                  </span>
                  <button
                    onClick={() => remove(todo.id)}
                    style="background: none; border: none; color: #666; cursor: pointer; font-size: 18px;"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>}
      </div>

      <div style="margin-top: 12px; color: #888; font-size: 13px;">
        {remaining()} {remaining() === 1 ? 'item' : 'items'} remaining
      </div>
    </div>
  );
}

mount(<TodoApp />, '#app');
`,
  },
  {
    id: 'computed-values',
    title: 'Computed Values',
    description: 'computed() and derived state',
    code: `import { signal, computed, mount } from 'what-framework';

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

  const fmt = (n) => '$' + n.toFixed(2);
  const labelStyle = 'color: #aaa; font-size: 13px; margin-bottom: 4px; display: block;';
  const inputStyle = 'padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px; width: 100%;';
  const rowStyle = 'display: flex; justify-content: space-between; padding: 8px 0; color: #aaa;';

  return (
    <div style="max-width: 400px; margin: 0 auto;">
      <h2>Price Calculator</h2>
      <p style="color: #888; margin-bottom: 20px;">
        All totals are computed() values — cached and reactive.
      </p>

      <div style="display: grid; gap: 16px; margin-bottom: 24px;">
        <div>
          <label style={labelStyle}>Unit Price</label>
          <input type="number" step="0.01" min="0" value={price()} onInput={(e) => price(+e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Quantity</label>
          <input type="number" min="1" value={quantity()} onInput={(e) => quantity(+e.target.value || 1)} style={inputStyle} />
        </div>
        <div>
          <label style={labelStyle}>Tax Rate</label>
          <select value={taxRate()} onChange={(e) => taxRate(+e.target.value)} style={inputStyle}>
            <option value="0">No Tax</option>
            <option value="0.05">5%</option>
            <option value="0.08">8%</option>
            <option value="0.1">10%</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Coupon Code</label>
          <input type="text" placeholder="Try SAVE10 or SAVE20" value={coupon()} onInput={(e) => coupon(e.target.value.toUpperCase())} style={inputStyle} />
        </div>
      </div>

      <div style="background: #1a1a2e; border-radius: 12px; padding: 20px;">
        <div style={rowStyle}>
          <span>Subtotal</span>
          <span>{fmt(subtotal())}</span>
        </div>
        {discount() > 0
          ? <div style="display: flex; justify-content: space-between; padding: 8px 0; color: #22c55e;">
              <span>Discount</span>
              <span>-{fmt(discount())}</span>
            </div>
          : null}
        <div style={rowStyle}>
          <span>Tax</span>
          <span>{fmt(tax())}</span>
        </div>
        <div style="display: flex; justify-content: space-between; padding: 12px 0; border-top: 1px solid #333; margin-top: 8px; font-size: 20px; font-weight: 600;">
          <span>Total</span>
          <span style="color: #8b5cf6;">{fmt(total())}</span>
        </div>
      </div>
    </div>
  );
}

mount(<PriceCalculator />, '#app');
`,
  },
  {
    id: 'effects',
    title: 'Effects',
    description: 'effect() with auto-tracking and cleanup',
    code: `import { signal, effect, mount } from 'what-framework';

function EffectDemo() {
  const count = signal(0, 'count');
  const color = signal('#8b5cf6', 'color');
  const logs = signal([], 'logs');
  const ticking = signal(false, 'ticking');
  let nextLogId = 1;

  const addLog = (text) => {
    const time = new Date().toLocaleTimeString();
    logs(prev => [...prev.slice(-8), { id: nextLogId++, text: \`[\${time}] \${text}\` }]);
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

  // Effect with interval (cleanup when ticking turns off)
  let interval = null;
  effect(() => {
    if (ticking()) {
      interval = setInterval(() => count(c => c + 1), 1000);
      addLog('Timer started');
    } else if (interval) {
      clearInterval(interval);
      interval = null;
      addLog('Timer stopped');
    }
  });

  return (
    <div style="max-width: 500px; margin: 0 auto;">
      <h2>Effects</h2>
      <p style="color: #888; margin-bottom: 20px;">
        effect() auto-tracks signal dependencies. No arrays needed.
      </p>

      <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 20px;">
        <button
          onClick={() => count(c => c + 1)}
          style="padding: 8px 20px; border-radius: 8px; border: 1px solid #8b5cf6; background: #8b5cf6; color: #fff; cursor: pointer;"
        >
          Increment ({count()})
        </button>
        <button
          onClick={() => ticking(t => !t)}
          style={\`padding: 8px 20px; border-radius: 8px; border: 1px solid \${ticking() ? '#ef4444' : '#22c55e'}; background: \${ticking() ? '#ef4444' : '#22c55e'}; color: #fff; cursor: pointer;\`}
        >
          {ticking() ? 'Stop Timer' : 'Start Timer'}
        </button>
        <input
          type="color"
          value={color()}
          onInput={(e) => color(e.target.value)}
          style="width: 44px; height: 38px; border: none; background: none; cursor: pointer;"
        />
      </div>

      <div style={\`width: 100%; height: 80px; border-radius: 12px; background: \${color()}; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: 700; color: #fff; margin-bottom: 20px; transition: background 0.3s;\`}>
        {count()}
      </div>

      <div style="background: #0d0d1a; border-radius: 8px; padding: 16px; font-family: monospace; font-size: 13px;">
        <div style="color: #666; margin-bottom: 8px;">Effect Log:</div>
        <div>
          {logs().map(entry => (
            <div key={entry.id} style="color: #aaa; padding: 2px 0;">{entry.text}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

mount(<EffectDemo />, '#app');
`,
  },
  {
    id: 'two-way-binding',
    title: 'Two-Way Binding',
    description: 'Form inputs with signals',
    code: `import { signal, computed, mount } from 'what-framework';

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

  return (
    <div style="max-width: 480px; margin: 0 auto;">
      <h2>Profile Form</h2>
      <p style="color: #888; margin-bottom: 20px;">
        Signals bind directly to inputs. No controlled/uncontrolled distinction.
      </p>

      {submitted()
        ? <div style="background: #1a2e1a; border: 1px solid #22c55e; border-radius: 12px; padding: 24px; text-align: center;">
            <div style="font-size: 48px; margin-bottom: 12px;">✓</div>
            <h3 style="color: #22c55e; margin-bottom: 8px;">Submitted!</h3>
            <p style="color: #aaa;">Welcome, {name()}!</p>
            <button
              onClick={() => submitted(false)}
              style="margin-top: 16px; padding: 8px 24px; border-radius: 8px; border: 1px solid #444; background: transparent; color: #eee; cursor: pointer;"
            >
              Edit
            </button>
          </div>
        : <div style="display: grid; gap: 16px;">
            <div>
              <label style={labelStyle}>Name *</label>
              <input type="text" value={name()} onInput={(e) => name(e.target.value)} placeholder="Your name" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Email *</label>
              <input type="email" value={email()} onInput={(e) => email(e.target.value)} placeholder="you@example.com" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select value={role()} onChange={(e) => role(e.target.value)} style={inputStyle}>
                <option value="developer">Developer</option>
                <option value="designer">Designer</option>
                <option value="manager">Manager</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Bio ({charCount()}/200)</label>
              <textarea
                rows="3"
                maxlength="200"
                value={bio()}
                onInput={(e) => bio(e.target.value)}
                placeholder="Tell us about yourself..."
                style={inputStyle + ' resize: vertical; min-height: 80px;'}
              ></textarea>
            </div>
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
              <input
                type="checkbox"
                checked={newsletter()}
                onChange={(e) => newsletter(e.target.checked)}
                style="width: 18px; height: 18px; accent-color: #8b5cf6;"
              />
              <span style="color: #aaa; font-size: 14px;">Subscribe to newsletter</span>
            </label>

            <div style="background: #1a1a2e; border-radius: 12px; padding: 16px; margin-top: 8px;">
              <div style="font-size: 13px; color: #666; margin-bottom: 8px;">Live Preview</div>
              <div style="font-weight: 600;">{name() || 'Your Name'}</div>
              <div style="color: #888; font-size: 14px;">{email() || 'email@example.com'}</div>
              <div style="color: #8b5cf6; font-size: 13px; margin-top: 4px;">{role()}</div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!isValid()}
              style={\`width: 100%; padding: 12px; border-radius: 8px; border: none; background: \${isValid() ? '#8b5cf6' : '#333'}; color: \${isValid() ? '#fff' : '#666'}; font-size: 16px; cursor: \${isValid() ? 'pointer' : 'not-allowed'}; font-weight: 500; transition: all 0.2s;\`}
            >
              Submit
            </button>
          </div>}
    </div>
  );
}

mount(<FormDemo />, '#app');
`,
  },
  {
    id: 'fetch-data',
    title: 'Async Data',
    description: 'Async data loading with signals',
    code: `import { signal, computed, mount } from 'what-framework';

// A small in-memory dataset — swap loadUsers for a real
// network request and the signal flow stays identical.
const TEAM = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', company: 'Analytical', site: 'ada.dev', phone: '555-0101', city: 'London' },
  { id: 2, name: 'Grace Hopper', email: 'grace@example.com', company: 'COBOL Inc', site: 'grace.dev', phone: '555-0102', city: 'Arlington' },
  { id: 3, name: 'Alan Turing', email: 'alan@example.com', company: 'Enigma Ltd', site: 'turing.dev', phone: '555-0103', city: 'Manchester' },
  { id: 4, name: 'Katherine Johnson', email: 'katherine@example.com', company: 'NASA', site: 'kj.dev', phone: '555-0104', city: 'Hampton' },
  { id: 5, name: 'Margaret Hamilton', email: 'margaret@example.com', company: 'MIT', site: 'mh.dev', phone: '555-0105', city: 'Boston' },
  { id: 6, name: 'Linus Torvalds', email: 'linus@example.com', company: 'Kernel Org', site: 'linus.dev', phone: '555-0106', city: 'Helsinki' },
];

function UserBrowser() {
  const users = signal([], 'users');
  const loading = signal(true, 'loading');
  const error = signal(null, 'error');
  const selected = signal(null, 'selected');
  const query = signal('', 'query');

  // Simulated API call — any async function works the same way
  async function loadUsers() {
    loading(true);
    error(null);
    try {
      await new Promise(resolve => setTimeout(resolve, 700));
      users(TEAM);
    } catch (err) {
      error(err.message);
    } finally {
      loading(false);
    }
  }

  loadUsers();

  const filtered = computed(() => {
    const q = query().toLowerCase();
    if (!q) return users();
    return users().filter(u =>
      u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    );
  });

  return (
    <div style="max-width: 600px; margin: 0 auto;">
      <h2>User Directory</h2>

      <div style="display: flex; gap: 8px; margin: 16px 0;">
        <input
          type="text"
          placeholder="Search users..."
          onInput={(e) => query(e.target.value)}
          style="flex: 1; padding: 10px 14px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; font-size: 14px;"
        />
        <button
          onClick={loadUsers}
          style="padding: 10px 16px; border-radius: 8px; border: 1px solid #444; background: #1a1a2e; color: #eee; cursor: pointer;"
        >
          Reload
        </button>
      </div>

      {loading()
        ? <div style="text-align: center; padding: 48px; color: #888;">
            <div style="font-size: 24px; animation: spin 1s linear infinite; display: inline-block;">↻</div>
            <p style="margin-top: 12px;">Loading users...</p>
          </div>
        : error()
          ? <div style="background: #2e1a1a; border: 1px solid #ef4444; border-radius: 12px; padding: 24px; text-align: center;">
              <p style="color: #ef4444;">Error: {error()}</p>
              <button
                onClick={loadUsers}
                style="margin-top: 12px; padding: 8px 20px; border-radius: 8px; border: 1px solid #ef4444; background: transparent; color: #ef4444; cursor: pointer;"
              >
                Retry
              </button>
            </div>
          : filtered().length === 0
            ? <p style="text-align: center; padding: 32px; color: #666;">No users found.</p>
            : <div style="display: grid; gap: 8px;">
                {filtered().map(user => (
                  <div
                    key={user.id}
                    onClick={() => selected(selected() === user.id ? null : user.id)}
                    style={\`padding: 14px 16px; border-radius: 10px; background: \${selected() === user.id ? '#1e1b4b' : '#1a1a2e'}; border: 1px solid \${selected() === user.id ? '#8b5cf6' : 'transparent'}; cursor: pointer; transition: all 0.2s;\`}
                  >
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <div style="font-weight: 600;">{user.name}</div>
                        <div style="color: #888; font-size: 13px;">{user.email}</div>
                      </div>
                      <div style="color: #8b5cf6; font-size: 13px;">{user.company}</div>
                    </div>
                    {selected() === user.id
                      ? <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #333; display: grid; gap: 6px; font-size: 13px; color: #aaa;">
                          <div>🌐 {user.site}</div>
                          <div>📞 {user.phone}</div>
                          <div>📍 {user.city}</div>
                        </div>
                      : null}
                  </div>
                ))}
              </div>}
    </div>
  );
}

mount(<UserBrowser />, '#app');
`,
  },
  {
    id: 'component-composition',
    title: 'Component Composition',
    description: 'Parent/child components with props',
    code: `import { signal, mount } from 'what-framework';

// Child component — receives props, manages local state
function Card({ title, color, children }) {
  const expanded = signal(true, 'expanded');

  return (
    <div style="border-radius: 12px; border: 1px solid #333; overflow: hidden; margin-bottom: 12px;">
      <div
        onClick={() => expanded(e => !e)}
        style={\`padding: 14px 18px; background: \${color}15; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;\`}
      >
        <span style={\`font-weight: 600; color: \${color};\`}>{title}</span>
        <span style="color: #666;">{expanded() ? '▼' : '▶'}</span>
      </div>
      {expanded() ? <div style="padding: 18px;">{children}</div> : null}
    </div>
  );
}

// Reusable stat display
function Stat({ label, value, trend }) {
  const trendColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#888';
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';

  return (
    <div style="text-align: center;">
      <div style="font-size: 28px; font-weight: 700;">{value}</div>
      <div style="color: #888; font-size: 13px; margin-top: 4px;">{label}</div>
      <div style={\`color: \${trendColor}; font-size: 13px; margin-top: 2px;\`}>{trendIcon}</div>
    </div>
  );
}

// Tag component
function Tag({ label, color }) {
  return (
    <span style={\`display: inline-block; padding: 4px 12px; border-radius: 999px; background: \${color}20; color: \${color}; font-size: 12px; font-weight: 500;\`}>
      {label}
    </span>
  );
}

// Parent component composes children
function Dashboard() {
  return (
    <div style="max-width: 600px; margin: 0 auto;">
      <h2>Dashboard</h2>
      <p style="color: #888; margin-bottom: 20px;">
        Components compose naturally. Each manages its own state.
      </p>

      <Card title="Statistics" color="#8b5cf6">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
          <Stat label="Users" value="2,847" trend="up" />
          <Stat label="Revenue" value="$12.4k" trend="up" />
          <Stat label="Bounce" value="24%" trend="down" />
        </div>
      </Card>

      <Card title="Tech Stack" color="#3b82f6">
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          <Tag label="Signals" color="#8b5cf6" />
          <Tag label="No VDOM" color="#22c55e" />
          <Tag label="Run Once" color="#3b82f6" />
          <Tag label="Fine-grained" color="#f59e0b" />
          <Tag label="Zero config" color="#ef4444" />
          <Tag label="~6kb" color="#06b6d4" />
        </div>
      </Card>

      <Card title="Recent Activity" color="#22c55e">
        <div style="display: grid; gap: 12px;">
          {['Deployed v2.1.0', 'Fixed auth bug', 'Added dark mode', 'Updated deps'].map((item, i) => (
            <div key={item} style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222;">
              <span>{item}</span>
              <span style="color: #666; font-size: 13px;">{i + 1}h ago</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

mount(<Dashboard />, '#app');
`,
  },
  {
    id: 'animations',
    title: 'Animations',
    description: 'Spring animations driven by signals',
    code: `import { signal, mount } from 'what-framework';

function AnimationDemo() {
  // Animated values are plain signals — the spring just writes to them
  const x = signal(0, 'x');
  const y = signal(0, 'y');
  const scale = signal(1, 'scale');
  const rotation = signal(0, 'rotation');
  const hue = signal(260, 'hue');
  const radius = signal(16, 'radius');
  const hovering = signal(false, 'hovering');

  // Physics-based spring: returns a setter that animates sig toward a target
  function spring(sig, opts = {}) {
    const { stiffness = 120, damping = 14 } = opts;
    let velocity = 0;
    let target = sig();
    let raf = null;
    let lastT = null;

    function tick(time) {
      if (lastT === null) { lastT = time; raf = requestAnimationFrame(tick); return; }
      const dt = Math.min((time - lastT) / 1000, 0.064);
      lastT = time;
      const current = sig();
      const disp = current - target;
      velocity += (-stiffness * disp - damping * velocity) * dt;
      if (Math.abs(velocity) < 0.01 && Math.abs(disp) < 0.01) {
        sig(target);
        velocity = 0; raf = null; lastT = null;
        return;
      }
      sig(current + velocity * dt);
      raf = requestAnimationFrame(tick);
    }

    return (v) => {
      target = v;
      if (raf === null) { lastT = null; raf = requestAnimationFrame(tick); }
    };
  }

  const moveX = spring(x);
  const moveY = spring(y);
  const scaleTo = spring(scale, { stiffness: 200, damping: 12 });
  const rotateTo = spring(rotation, { stiffness: 80, damping: 10 });
  const hueTo = spring(hue, { stiffness: 60, damping: 15 });
  const radiusTo = spring(radius);

  const randomize = () => {
    moveX((Math.random() - 0.5) * 200);
    moveY((Math.random() - 0.5) * 150);
    rotateTo(Math.random() * 360);
    hueTo(Math.random() * 360);
    radiusTo(Math.random() * 50);
  };

  const reset = () => {
    moveX(0); moveY(0); scaleTo(1);
    rotateTo(0); hueTo(260); radiusTo(16);
  };

  const ctrlStyle = 'padding: 10px 24px; border-radius: 8px; border: 1px solid #444; background: transparent; color: #eee; font-size: 14px; cursor: pointer;';

  return (
    <div style="max-width: 600px; margin: 0 auto; text-align: center;">
      <h2>Spring Animations</h2>
      <p style="color: #888; margin-bottom: 24px;">
        Physics-based springs. Move your mouse over the box.
      </p>

      <div
        style="height: 300px; display: flex; align-items: center; justify-content: center; background: #0d0d1a; border-radius: 16px; margin-bottom: 24px; overflow: hidden; position: relative;"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          moveX((e.clientX - rect.left - rect.width / 2) * 0.3);
          moveY((e.clientY - rect.top - rect.height / 2) * 0.3);
        }}
        onMouseEnter={() => { hovering(true); scaleTo(1.15); }}
        onMouseLeave={() => { hovering(false); scaleTo(1); moveX(0); moveY(0); }}
      >
        <div style={\`width: 120px; height: 120px; border-radius: \${radius()}px; background: hsl(\${hue()}, 70%, 60%); transform: translate(\${x()}px, \${y()}px) scale(\${scale()}) rotate(\${rotation()}deg); transition: box-shadow 0.3s; box-shadow: 0 0 \${hovering() ? '40' : '20'}px hsla(\${hue()}, 70%, 60%, 0.4);\`}></div>
      </div>

      <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
        <button
          onClick={randomize}
          style="padding: 10px 24px; border-radius: 8px; border: none; background: #8b5cf6; color: #fff; font-size: 14px; cursor: pointer;"
        >
          Randomize
        </button>
        <button onClick={reset} style={ctrlStyle}>Reset</button>
        <button
          onClick={() => {
            hueTo(Math.random() * 360);
            radiusTo(radius() > 30 ? 4 : 60);
          }}
          style={ctrlStyle}
        >
          Morph
        </button>
      </div>

      <div style="margin-top: 20px; font-family: monospace; font-size: 12px; color: #666;">
        {\`x: \${x().toFixed(1)}  y: \${y().toFixed(1)}  scale: \${scale().toFixed(2)}  rotation: \${rotation().toFixed(0)}deg\`}
      </div>
    </div>
  );
}

mount(<AnimationDemo />, '#app');
`,
  },
  {
    id: 'theme-switcher',
    title: 'Theme Switcher',
    description: 'Reactive CSS and styling',
    code: `import { signal, computed, mount } from 'what-framework';

const themes = {
  midnight: { bg: '#0a0a1a', surface: '#12122a', accent: '#8b5cf6', text: '#e4e4f0', muted: '#6b6b8a', name: 'Midnight' },
  forest:   { bg: '#0a1a0d', surface: '#122a16', accent: '#22c55e', text: '#e4f0e6', muted: '#6b8a6e', name: 'Forest' },
  ocean:    { bg: '#0a141a', surface: '#12242a', accent: '#3b82f6', text: '#e4ecf0', muted: '#6b7f8a', name: 'Ocean' },
  sunset:   { bg: '#1a0f0a', surface: '#2a1912', accent: '#f59e0b', text: '#f0ece4', muted: '#8a7d6b', name: 'Sunset' },
  rose:     { bg: '#1a0a14', surface: '#2a1222', accent: '#ec4899', text: '#f0e4ec', muted: '#8a6b7f', name: 'Rose' },
};

function ThemeSwitcher() {
  const current = signal('midnight', 'theme');
  const fontSize = signal(16, 'fontSize');
  const spacing = signal(16, 'spacing');
  const radius = signal(12, 'radius');

  const theme = computed(() => themes[current()]);

  return (
    <div style={\`min-height: 100vh; background: \${theme().bg}; color: \${theme().text}; padding: \${spacing() * 2}px; font-size: \${fontSize()}px; transition: all 0.4s ease;\`}>
      <div style="max-width: 560px; margin: 0 auto;">
        <h2 style={\`color: \${theme().accent};\`}>Theme Switcher</h2>
        <p style={\`color: \${theme().muted}; margin-bottom: 24px;\`}>
          Signals drive CSS. Every change is surgically applied to the DOM.
        </p>

        <div style={\`display: flex; gap: \${spacing() / 2}px; margin-bottom: \${spacing() * 1.5}px; flex-wrap: wrap;\`}>
          {Object.entries(themes).map(([key, t]) => (
            <button
              key={key}
              onClick={() => current(key)}
              style={\`padding: 10px 18px; border-radius: \${radius()}px; border: 2px solid \${current() === key ? t.accent : 'transparent'}; background: \${t.surface}; color: \${t.accent}; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.3s;\`}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div style={\`background: \${theme().surface}; border-radius: \${radius()}px; padding: \${spacing()}px; margin-bottom: \${spacing()}px;\`}>
          <div style="margin-bottom: 16px;">
            <label style={\`color: \${theme().muted}; font-size: 13px; display: block; margin-bottom: 6px;\`}>
              Font Size: {fontSize()}px
            </label>
            <input
              type="range" min="12" max="24" value={fontSize()}
              onInput={(e) => fontSize(+e.target.value)}
              style={\`width: 100%; accent-color: \${theme().accent};\`}
            />
          </div>
          <div style="margin-bottom: 16px;">
            <label style={\`color: \${theme().muted}; font-size: 13px; display: block; margin-bottom: 6px;\`}>
              Spacing: {spacing()}px
            </label>
            <input
              type="range" min="8" max="32" value={spacing()}
              onInput={(e) => spacing(+e.target.value)}
              style={\`width: 100%; accent-color: \${theme().accent};\`}
            />
          </div>
          <div>
            <label style={\`color: \${theme().muted}; font-size: 13px; display: block; margin-bottom: 6px;\`}>
              Border Radius: {radius()}px
            </label>
            <input
              type="range" min="0" max="24" value={radius()}
              onInput={(e) => radius(+e.target.value)}
              style={\`width: 100%; accent-color: \${theme().accent};\`}
            />
          </div>
        </div>

        <div style={\`display: grid; grid-template-columns: 1fr 1fr; gap: \${spacing()}px;\`}>
          {['Primary Card', 'Secondary Card', 'Status: Active', 'Notifications: 3'].map((label) => (
            <div key={label} style={\`background: \${theme().surface}; border-radius: \${radius()}px; padding: \${spacing()}px; border-left: 3px solid \${theme().accent};\`}>
              <div style="font-weight: 600; margin-bottom: 6px;">{label}</div>
              <div style={\`color: \${theme().muted}; font-size: 13px;\`}>
                Every property is reactive
              </div>
            </div>
          ))}
        </div>

        <pre style={\`margin-top: \${spacing()}px; background: \${theme().surface}; border-radius: \${radius()}px; padding: \${spacing()}px; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: \${theme().muted}; overflow-x: auto;\`}>
          {\`theme: "\${current()}"\\nfontSize: \${fontSize()}px\\nspacing: \${spacing()}px\\nradius: \${radius()}px\\naccent: "\${theme().accent}"\`}
        </pre>
      </div>
    </div>
  );
}

mount(<ThemeSwitcher />, '#app');
`,
  },
  {
    id: 'stopwatch',
    title: 'Stopwatch',
    description: 'Precise timing with signals',
    code: `import { signal, computed, mount } from 'what-framework';

function StopwatchApp() {
  const elapsed = signal(0, 'elapsed');
  const running = signal(false, 'running');
  const laps = signal([], 'laps');
  let interval = null;
  let startTime = 0;
  let accumulated = 0;

  const formatMs = (ms) => {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const c = Math.floor((ms % 1000) / 10);
    return \`\${String(m).padStart(2, '0')}:\${String(s).padStart(2, '0')}.\${String(c).padStart(2, '0')}\`;
  };

  const formatted = computed(() => formatMs(elapsed()));

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
    laps(prev => [...prev, {
      id: prev.length + 1,
      total: elapsed(),
      split: elapsed() - (prev.length > 0 ? prev[prev.length - 1].total : 0),
    }]);
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

  return (
    <div style="max-width: 400px; margin: 0 auto; text-align: center;">
      <h2 style="margin-bottom: 32px;">Stopwatch</h2>

      <div style={'font-size: 64px; font-weight: 200; font-variant-numeric: tabular-nums; font-family: "JetBrains Mono", monospace; letter-spacing: 2px; margin-bottom: 32px;'}>
        {formatted()}
      </div>

      <div style={\`width: 8px; height: 8px; border-radius: 50%; margin: 0 auto 24px; background: \${running() ? '#22c55e' : elapsed() > 0 ? '#f59e0b' : '#444'}; box-shadow: 0 0 \${running() ? '12px #22c55e' : '0px transparent'}; transition: all 0.3s;\`}></div>

      <div style="display: flex; gap: 12px; justify-content: center; margin-bottom: 32px;">
        {!running()
          ? <button onClick={start} style={btnBase + ' background: #22c55e; color: #fff;'}>
              {elapsed() > 0 ? 'Resume' : 'Start'}
            </button>
          : <button onClick={stop} style={btnBase + ' background: #ef4444; color: #fff;'}>
              Stop
            </button>}
        <button
          onClick={() => (running() ? lap() : reset())}
          disabled={!running() && elapsed() === 0}
          style={\`\${btnBase} background: #333; color: \${!running() && elapsed() === 0 ? '#555' : '#eee'};\`}
        >
          {running() ? 'Lap' : 'Reset'}
        </button>
      </div>

      {laps().length > 0
        ? <div style="text-align: left; background: #1a1a2e; border-radius: 12px; overflow: hidden;">
            <div style="padding: 12px 16px; font-size: 13px; color: #666; border-bottom: 1px solid #333; display: flex; justify-content: space-between;">
              <span>Lap</span>
              <span>Split</span>
              <span>Total</span>
            </div>
            {laps().slice().reverse().map(l => (
              <div
                key={l.id}
                style={\`padding: 10px 16px; border-bottom: 1px solid #222; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; color: \${l.id === bestLap() ? '#22c55e' : l.id === worstLap() ? '#ef4444' : '#ccc'};\`}
              >
                <span style="color: #666;">Lap {l.id}</span>
                <span>{formatMs(l.split)}</span>
                <span style="color: #888;">{formatMs(l.total)}</span>
              </div>
            ))}
          </div>
        : null}
    </div>
  );
}

mount(<StopwatchApp />, '#app');
`,
  },
  {
    id: 'markdown-preview',
    title: 'Markdown Preview',
    description: 'Live text transformation with signals',
    code: `import { signal, computed, mount } from 'what-framework';

function MarkdownPreview() {
  const input = signal(\`# Hello What Framework!

This is a **live markdown preview** powered by signals.

## Features
- *Italic text* and **bold text**
- Code: \\\`signal()\\\`, \\\`computed()\\\`, \\\`effect()\\\`
- Links and more

### How it works
The input is a signal. The preview is a computed value.
Every keystroke updates — but **only the preview DOM node changes**.

> Components run once. Signals do the rest.

---

Try editing this text!\`, 'markdown');

  // Minimal markdown parser (no library needed)
  const rendered = computed(() => {
    return input()
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
      .replace(/^- (.+)$/gm, '<div style="padding: 2px 0 2px 16px;">• $1</div>')
      // Paragraphs
      .replace(/\\n\\n/g, '<br><br>');
  });

  const wordCount = computed(() => {
    const text = input().trim();
    return text ? text.split(/\\s+/).length : 0;
  });

  const charCount = computed(() => input().length);

  return (
    <div style="max-width: 900px; margin: 0 auto;">
      <h2>Markdown Preview</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
        <div>
          <div style="color: #666; font-size: 13px; margin-bottom: 8px; display: flex; justify-content: space-between;">
            <span>Markdown</span>
            <span>{wordCount()} words, {charCount()} chars</span>
          </div>
          <textarea
            value={input()}
            onInput={(e) => input(e.target.value)}
            style={'width: 100%; height: 500px; padding: 16px; border-radius: 12px; border: 1px solid #333; background: #0d0d1a; color: #ddd; font-family: "JetBrains Mono", monospace; font-size: 14px; line-height: 1.6; resize: none;'}
          ></textarea>
        </div>
        <div>
          <div style="color: #666; font-size: 13px; margin-bottom: 8px;">Preview</div>
          {/* rendered() is a computed — the HTML updates reactively */}
          <div
            dangerouslySetInnerHTML={{ __html: rendered() }}
            style="height: 500px; overflow-y: auto; padding: 16px; border-radius: 12px; border: 1px solid #333; background: #12121e; line-height: 1.7;"
          ></div>
        </div>
      </div>
    </div>
  );
}

mount(<MarkdownPreview />, '#app');
`,
  },
];
