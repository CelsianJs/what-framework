export const examples = {
  counter: {
    label: 'Counter',
    code: `function Counter() {
  const count = signal(0, 'count');
  return (
    <div style="text-align: center; padding: 2rem;">
      <h1>Count: {count()}</h1>
      <button onClick={() => count(c => c + 1)}>+1</button>
      <button onClick={() => count(0)}>Reset</button>
    </div>
  );
}
mount(<Counter />, '#app');`,
  },

  todo: {
    label: 'Todo List',
    code: `function TodoApp() {
  const todos = signal([], 'todos');
  const input = signal('', 'input');

  const add = () => {
    if (!input()) return;
    todos(t => [...t, { id: Date.now(), text: input(), done: false }]);
    input('');
  };

  return (
    <div style="max-width: 400px; margin: 2rem auto;">
      <h1>Todos</h1>
      <div style="display: flex; gap: 8px;">
        <input value={input} onInput={e => input(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && add()}
               placeholder="What needs doing?" style="flex: 1; padding: 8px;" />
        <button onClick={add}>Add</button>
      </div>
      <ul style="list-style: none; padding: 0;">
        {() => todos().map(todo => (
          <li key={todo.id} style="padding: 8px; border-bottom: 1px solid #eee;">
            <label style={{textDecoration: todo.done ? 'line-through' : 'none'}}>
              <input type="checkbox" checked={todo.done}
                     onChange={() => todos(t => t.map(x => x.id === todo.id ? {...x, done: !x.done} : x))} />
              {' '}{todo.text}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
mount(<TodoApp />, '#app');`,
  },

  effects: {
    label: 'Reactive Effects',
    code: `function EffectsDemo() {
  const name = signal('World', 'name');
  const greeting = computed(() => \`Hello, \${name()}!\`);

  effect(() => {
    console.log('Greeting changed:', greeting());
  });

  return (
    <div style="padding: 2rem;">
      <h1>{greeting}</h1>
      <input value={name} onInput={e => name(e.target.value)}
             placeholder="Your name" style="padding: 8px; font-size: 1.2rem;" />
      <p style="color: #666; margin-top: 1rem;">
        Open the console to see the effect fire on each keystroke.
      </p>
    </div>
  );
}
mount(<EffectsDemo />, '#app');`,
  },

  computed: {
    label: 'Computed Chain',
    code: `function ComputedChain() {
  const base = signal(10, 'base');
  const doubled = computed(() => base() * 2);
  const quadrupled = computed(() => doubled() * 2);
  const label = computed(() => \`\${base()} -> \${doubled()} -> \${quadrupled()}\`);

  return (
    <div style="padding: 2rem; font-family: monospace;">
      <h1>Computed Chain</h1>
      <p style="font-size: 1.5rem; margin: 1rem 0;">{label}</p>
      <input type="range" min="0" max="100" value={base}
             onInput={e => base(Number(e.target.value))}
             style="width: 300px;" />
      <div style="margin-top: 1rem; color: #666;">
        <p>base = {() => base()}</p>
        <p>doubled = {() => doubled()}</p>
        <p>quadrupled = {() => quadrupled()}</p>
      </div>
    </div>
  );
}
mount(<ComputedChain />, '#app');`,
  },

  signals: {
    label: 'Signal Demo',
    code: `function SignalDemo() {
  const color = signal('#61afef', 'color');
  const size = signal(48, 'size');
  const text = signal('What!', 'text');

  return (
    <div style="padding: 2rem; text-align: center;">
      <div style={() => \`font-size: \${size()}px; color: \${color()}; transition: all 0.2s; margin: 2rem 0;\`}>
        {text}
      </div>
      <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
        <label>
          Color: <input type="color" value={color}
                        onInput={e => color(e.target.value)} />
        </label>
        <label>
          Size: <input type="range" min="12" max="120" value={size}
                       onInput={e => size(Number(e.target.value))} />
          {() => size()}px
        </label>
        <label>
          Text: <input value={text} onInput={e => text(e.target.value)}
                       style="padding: 4px 8px;" />
        </label>
      </div>
    </div>
  );
}
mount(<SignalDemo />, '#app');`,
  },
};
