/**
 * what-react compat test — tests major React ecosystem libraries
 *
 * Uses React-style JSX (automatic runtime) — esbuild transforms JSX to
 * jsx() calls from 'react/jsx-runtime', which is aliased to what-react.
 * No what compiler plugin needed.
 *
 * 20 confirmed working libraries across state management, routing, forms,
 * UI components, animation, data fetching, icons, drag & drop, markdown,
 * notifications, virtualization, i18n, and document head management.
 */
import { createRoot } from 'react-dom/client';
import { ZustandTest } from './test-zustand.jsx';
import { FramerTest } from './test-framer.jsx';
import { RadixTest } from './test-radix.jsx';
import { SpringTest } from './test-spring.jsx';
import { AntdTest } from './test-antd.jsx';
import { QueryTest } from './test-query.jsx';
import { RouterTest } from './test-router.jsx';
import { HookFormTest } from './test-hookform.jsx';
import { TableTest } from './test-table.jsx';
import { SWRTest } from './test-swr.jsx';
import { IconsTest } from './test-icons.jsx';
import { JotaiTest } from './test-jotai.jsx';
import { DndTest } from './test-dnd.jsx';
import { MarkdownTest } from './test-markdown.jsx';
import { ToastTest } from './test-toast.jsx';
import { VirtualTest } from './test-virtual.jsx';
import { I18nTest } from './test-i18n.jsx';
import { HeadlessTest } from './test-headless.jsx';
import { ToastifyTest } from './test-toastify.jsx';
import { HelmetTest } from './test-helmet.jsx';

function Section({ num, title, children }) {
  return (
    <>
      <section>
        <h2>{num}. {title}</h2>
        {children}
      </section>
      <hr />
    </>
  );
}

function App() {
  return (
    <div style={{ fontFamily: 'system-ui', padding: '2rem', maxWidth: '900px', margin: '0 auto' }}>
      <h1>what-react Compatibility Tests</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        20 React libraries running on What Framework via the compat layer
      </p>

      <Section num={1} title="Zustand (State Management)"><ZustandTest /></Section>
      <Section num={2} title="Framer Motion (Animation)"><FramerTest /></Section>
      <Section num={3} title="Radix UI (Headless Components)"><RadixTest /></Section>
      <Section num={4} title="React Spring (Physics Animation)"><SpringTest /></Section>
      <Section num={5} title="TanStack React Query (Server State)"><QueryTest /></Section>
      <Section num={6} title="React Router v6 (Routing)"><RouterTest /></Section>
      <Section num={7} title="Ant Design (UI Components)"><AntdTest /></Section>
      <Section num={8} title="React Hook Form (Forms)"><HookFormTest /></Section>
      <Section num={9} title="TanStack Table (Data Grid)"><TableTest /></Section>
      <Section num={10} title="SWR (Data Fetching)"><SWRTest /></Section>
      <Section num={11} title="React Icons (SVG Icons)"><IconsTest /></Section>
      <Section num={12} title="Jotai (Atomic State)"><JotaiTest /></Section>
      <Section num={13} title="dnd-kit (Drag & Drop)"><DndTest /></Section>
      <Section num={14} title="React Markdown (Content)"><MarkdownTest /></Section>
      <Section num={15} title="React Hot Toast (Notifications)"><ToastTest /></Section>
      <Section num={16} title="TanStack Virtual (Virtualization)"><VirtualTest /></Section>
      <Section num={17} title="react-i18next (Internationalization)"><I18nTest /></Section>
      <Section num={18} title="Headless UI (Accessible Components)"><HeadlessTest /></Section>
      <Section num={19} title="React Toastify (Notifications)"><ToastifyTest /></Section>
      <Section num={20} title="React Helmet (Document Head)"><HelmetTest /></Section>
    </div>
  );
}

const root = createRoot(document.getElementById('app'));
root.render(<App />);
