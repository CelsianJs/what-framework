import {
  useState, useSignal, useEffect, useRef, useMemo, useReducer,
  signal, computed, batch,
  // Animation
  spring, tween,
  // Data fetching
  useSWR,
  // Forms
  useForm, rules, simpleResolver,
  // Accessibility
  useFocusTrap, announce, Keys,
  // Skeleton
  Skeleton, SkeletonText, SkeletonCard,
  // Utils
  cls,
} from 'what-framework';

// --- Counter Demo ---
function Counter() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);

  return (
    <div class="demo-card">
      <h3 class="demo-title">Counter with Computed</h3>
      <div class="counter">
        <button class="counter-btn" onClick={() => setCount(c => c - 1)}>{'\u2212'}</button>
        <span class="counter-value">{count}</span>
        <button class="counter-btn" onClick={() => setCount(c => c + 1)}>+</button>
      </div>
      <p class="text-muted text-center mt-4">Doubled: {doubled}</p>
    </div>
  );
}

// --- Todo List Demo ---
function TodoList() {
  const [todos, setTodos] = useState([]);
  const [input, setInput] = useState('');
  const inputRef = useRef(null);

  const remaining = useMemo(
    () => todos.filter(t => !t.done).length,
    [todos]
  );

  const addTodo = () => {
    if (!input.trim()) return;
    setTodos(prev => [...prev, { id: Date.now(), text: input.trim(), done: false }]);
    setInput('');
  };

  const toggle = (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  };

  const remove = (id) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div class="demo-card">
      <h3 class="demo-title">Todo List</h3>
      <div class="todo-input">
        <input
          ref={inputRef}
          value={input}
          placeholder="Add a todo..."
          onInput={(e) => setInput(e.target.value)}
          onKeydown={(e) => e.key === 'Enter' && addTodo()}
        />
        <button onClick={addTodo}>Add</button>
      </div>
      <ul class="todo-list">
        {() => todos.map(todo =>
          <li key={todo.id} class={`todo-item${todo.done ? ' done' : ''}`}>
            <div class="todo-checkbox" onClick={() => toggle(todo.id)}></div>
            <span onClick={() => toggle(todo.id)}>{todo.text}</span>
            <button onClick={() => remove(todo.id)}>{'\u00d7'}</button>
          </li>
        )}
      </ul>
      {() => todos.length > 0
        ? <p class="todo-stats">{`${remaining} remaining of ${todos.length} total`}</p>
        : <p class="todo-stats">No todos yet. Add one above!</p>
      }
    </div>
  );
}

// --- Timer Demo ---
function Timer() {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSeconds(s => s + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const formatted = useMemo(() => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }, [seconds]);

  return (
    <div class="demo-card">
      <h3 class="demo-title">Timer</h3>
      <div class="text-center">
        <span class="counter-value">{formatted}</span>
      </div>
      <div class="flex justify-center gap-4 mt-4">
        <button class="btn btn-primary" onClick={() => setRunning(r => !r)}>
          {() => running ? 'Pause' : 'Start'}
        </button>
        <button class="btn btn-secondary" onClick={() => { setRunning(false); setSeconds(0); }}>
          Reset
        </button>
      </div>
    </div>
  );
}

// --- Reducer Demo ---
function ReducerDemo() {
  function reducer(state, action) {
    switch (action.type) {
      case 'increment': return { count: state.count + 1 };
      case 'decrement': return { count: state.count - 1 };
      case 'reset': return { count: 0 };
      default: return state;
    }
  }

  const [state, dispatch] = useReducer(reducer, { count: 0 });

  return (
    <div class="demo-card">
      <h3 class="demo-title">useReducer</h3>
      <div class="counter">
        <button class="counter-btn" onClick={() => dispatch({ type: 'decrement' })}>{'\u2212'}</button>
        <span class="counter-value">{state.count}</span>
        <button class="counter-btn" onClick={() => dispatch({ type: 'increment' })}>+</button>
      </div>
      <div class="text-center mt-4">
        <button class="btn btn-secondary" onClick={() => dispatch({ type: 'reset' })}>Reset</button>
      </div>
    </div>
  );
}

// --- Spring Animation Demo ---
function SpringDemo() {
  const x = spring(0, { stiffness: 200, damping: 20 });
  const scale = spring(1, { stiffness: 300, damping: 25 });

  const handleMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.width / 2;
    const mouseX = e.clientX - rect.left;
    x.set((mouseX - centerX) * 0.3);
  };

  const handleMouseLeave = () => {
    x.set(0);
    scale.set(1);
  };

  return (
    <div class="demo-card">
      <h3 class="demo-title">Spring Animation</h3>
      <div
        onMouseMove={handleMouseMove}
        onMouseEnter={() => scale.set(1.1)}
        onMouseLeave={handleMouseLeave}
        style={{
          height: '120px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-subtle)',
          borderRadius: 'var(--radius-lg)',
          cursor: 'pointer',
        }}
      >
        <div style={() => ({
          width: '60px',
          height: '60px',
          background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)',
          borderRadius: 'var(--radius-xl)',
          transform: `translateX(${x.current()}px) scale(${scale.current()})`,
        })}></div>
      </div>
      <p class="text-muted text-center mt-4">Move mouse over the area</p>
    </div>
  );
}

// --- Form Validation Demo ---
function FormDemo() {
  const { register, handleSubmit, formState, reset } = useForm({
    defaultValues: { email: '', password: '' },
    resolver: simpleResolver({
      email: [rules.required('Email is required'), rules.email()],
      password: [rules.required('Password is required'), rules.minLength(6, 'Min 6 characters')],
    }),
  });

  const [submitted, setSubmitted] = useState(null);

  const onSubmit = (data) => {
    setSubmitted(data);
    setTimeout(() => setSubmitted(null), 3000);
    reset();
  };

  return (
    <div class="demo-card">
      <h3 class="demo-title">Form Validation</h3>
      {() => submitted ? (
        <div style={{
          padding: '1rem',
          background: 'var(--color-success)',
          color: 'white',
          borderRadius: 'var(--radius-lg)',
          marginBottom: '1rem',
        }}>{'\u2713'} Form submitted: {() => submitted?.email}</div>
      ) : null}
      <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <input
            {...register('email')}
            placeholder="Email"
            style={() => ({
              width: '100%',
              padding: '0.75rem 1rem',
              border: formState.errors.email ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              fontSize: 'var(--text-sm)',
            })}
          />
          {() => formState.errors.email ? (
            <span style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: '0.25rem', display: 'block' }}>
              {formState.errors.email?.message}
            </span>
          ) : null}
        </div>
        <div>
          <input
            {...register('password')}
            type="password"
            placeholder="Password"
            style={() => ({
              width: '100%',
              padding: '0.75rem 1rem',
              border: formState.errors.password ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              fontSize: 'var(--text-sm)',
            })}
          />
          {() => formState.errors.password ? (
            <span style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: '0.25rem', display: 'block' }}>
              {formState.errors.password?.message}
            </span>
          ) : null}
        </div>
        <button
          type="submit"
          class="btn btn-primary"
          disabled={() => formState.isSubmitting()}
        >{() => formState.isSubmitting() ? 'Submitting...' : 'Submit'}</button>
      </form>
    </div>
  );
}

// --- Data Fetching Demo ---
function DataDemo() {
  const mockFetch = () => new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: 1, name: 'Alice', role: 'Engineer' },
        { id: 2, name: 'Bob', role: 'Designer' },
        { id: 3, name: 'Carol', role: 'PM' },
      ]);
    }, 1000);
  });

  const { data, error, isLoading, mutate } = useSWR('demo-users', mockFetch);

  return (
    <div class="demo-card">
      <h3 class="demo-title">Data Fetching (SWR)</h3>
      <div class="mb-4">
        <button class="btn btn-secondary" onClick={() => mutate()}>{'\u21bb'} Refetch</button>
      </div>
      {() => isLoading() ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Skeleton width="100%" height={48} />
          <Skeleton width="100%" height={48} />
          <Skeleton width="100%" height={48} />
        </div>
      ) : null}
      {() => error() ? <p style={{ color: 'var(--color-error)' }}>Error loading data</p> : null}
      {() => data() && !isLoading() ? (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {() => (data() || []).map(user =>
            <li key={user.id} style={{
              padding: '0.75rem 1rem',
              background: 'var(--color-bg-subtle)',
              borderRadius: 'var(--radius-md)',
              marginBottom: '0.5rem',
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <span class="font-medium">{user.name}</span>
              <span class="text-muted">{user.role}</span>
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}

// --- Skeleton Demo ---
function SkeletonDemo() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => setLoading(l => !l), 2000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div class="demo-card">
      <h3 class="demo-title">Skeleton Loaders</h3>
      <p class="text-muted mb-4">
        Auto-toggles every 2s: {() => loading ? 'Loading...' : 'Loaded!'}
      </p>
      {() => loading ? (
        <div style={{ display: 'flex', gap: '1rem' }}>
          <Skeleton width={60} height={60} style={{ borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <Skeleton width="60%" height={20} style={{ marginBottom: '0.5rem' }} />
            <SkeletonText lines={2} style={{ gap: '0.5rem' }} />
          </div>
        </div>
      ) : null}
      {() => !loading ? (
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)',
          }}></div>
          <div>
            <h4 style={{ margin: 0 }}>John Doe</h4>
            <p class="text-muted" style={{ margin: 0 }}>Software Engineer at Acme Inc.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Accessibility Demo ---
function A11yDemo() {
  const [modalOpen, setModalOpen] = useState(false);
  const [announceText, setAnnounceText] = useState('');
  const modalRef = { current: null };

  useFocusTrap(modalRef, modalOpen);

  const openModal = () => {
    setModalOpen(true);
    announce('Modal opened. Press Escape to close.');
    setAnnounceText('Modal opened');
  };

  const closeModal = () => {
    setModalOpen(false);
    announce('Modal closed');
    setAnnounceText('Modal closed');
  };

  return (
    <div class="demo-card">
      <h3 class="demo-title">Accessibility</h3>
      <div class="flex gap-4 mb-4">
        <button class="btn btn-primary" onClick={openModal}>Open Modal</button>
        <button class="btn btn-secondary" onClick={() => {
          announce('Hello! This is a screen reader announcement.');
          setAnnounceText('Announcement sent');
        }}>Announce</button>
      </div>
      {() => announceText ? (
        <p class="text-muted" style={{ fontStyle: 'italic' }}>
          Last action: {announceText}
        </p>
      ) : null}
      {() => modalOpen ? (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }} onClick={(e) => e.target === e.currentTarget && closeModal()}>
          <div
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            class="animate-scale-in"
            style={{
              background: 'var(--color-surface)',
              padding: '2rem',
              borderRadius: 'var(--radius-xl)',
              maxWidth: '400px',
              width: '90%',
              boxShadow: 'var(--shadow-xl)',
            }}
            onKeyDown={(e) => e.key === Keys.Escape && closeModal()}
          >
            <h4 id="modal-title" style={{ marginTop: 0, marginBottom: '1rem' }}>Accessible Modal</h4>
            <p class="text-secondary">Focus is trapped inside this modal. Tab through the buttons to see.</p>
            <div class="flex gap-4 mt-8">
              <button class="btn btn-secondary">Action 1</button>
              <button class="btn btn-secondary">Action 2</button>
              <button class="btn btn-primary" onClick={closeModal}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Main Demos Page ---
export function Demos() {
  return (
    <div class="section">
      <div class="features-header">
        <p class="features-label">Interactive</p>
        <h1 class="features-title">Live Demos</h1>
        <p class="features-subtitle">
          Each demo showcases a different feature of the What framework.
          All state is local, all updates are fine-grained signal-driven.
        </p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: var(--space-6);">
        <Counter />
        <Timer />
        <ReducerDemo />
        <SpringDemo />
      </div>

      <div class="mt-12">
        <h2 class="section-title">Stateful Components</h2>
        <TodoList />
      </div>

      <div class="mt-12">
        <h2 class="section-title">Forms & Data</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: var(--space-6);">
          <FormDemo />
          <DataDemo />
        </div>
      </div>

      <div class="mt-12">
        <h2 class="section-title">UI Utilities</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: var(--space-6);">
          <SkeletonDemo />
          <A11yDemo />
        </div>
      </div>
    </div>
  );
}
