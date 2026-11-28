// A native What file. Every JSX tag below that comes from React (recharts
// through a barrel, the app's React files) is a React island; the rest is
// native What. main.jsx mounts it, entry-client.jsx hydrates the server's
// render of it (entry-server.jsx).
import { signal } from 'what-framework';
import { BarChart, Bar, XAxis } from './ui/index.js';
import { OldBadge } from './OldBadge.jsx';
import { ThemeProvider, ThemedLabel, Chip } from './theme.jsx';
import { Panel } from './Panel.jsx';
import { SignupForm } from './SignupForm.jsx';

const n = signal(1);
const show = signal(true);
const hooks = typeof window !== 'undefined' ? window : {};
hooks.inc = () => n(n() + 1);
hooks.hide = () => show(false);
const tags = signal([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
hooks.renameTag = () => tags(tags().map((t) => (t.id === 1 ? { ...t, name: 'a2' } : t)));
hooks.addTag = () => tags([{ id: 3, name: 'c' }, ...tags()]);

export function Dashboard() {
  const rows = () => [{ l: 'a', v: n() }, { l: 'b', v: 3 }, ...Array.from({ length: n() }, (_, i) => ({ l: 'x' + i, v: i + 1 }))];
  return (
    <main>
      <p id="native">{n()}</p>
      <OldBadge n={n()} onPick={() => n(n() + 10)}>
        <i id="kid">hi {n()}</i>
      </OldBadge>
      {show() ? (
        <BarChart width={300} height={150} data={rows()}>
          <XAxis dataKey="l" />
          <Bar dataKey="v" fill="#36c" isAnimationActive={false} />
        </BarChart>
      ) : <b id="gone">gone</b>}
      <ThemeProvider theme={n() > 5 ? 'dark' : 'light'}>
        <Panel title={`Panel ${n()}`}>
          <ThemedLabel />
        </Panel>
      </ThemeProvider>
      <SignupForm />
      <ul id="tags">{tags().map((t) => <Chip key={t.id} label={t.name} />)}</ul>
    </main>
  );
}

