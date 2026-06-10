// what-react browser acceptance app — each section exercises one real React
// library end-to-end on the compat runtime. JSX compiles via the automatic
// runtime ('react' → what-react through the reactCompat() vite plugin).
import { createRoot } from 'react-dom/client';
import { ContextSection } from './sections/context-section.jsx';
import { ZustandSection } from './sections/zustand-section.jsx';
import { QuerySection } from './sections/query-section.jsx';
import { FormSection } from './sections/form-section.jsx';
import { ToastSection } from './sections/toast-section.jsx';
import { MenuSection } from './sections/menu-section.jsx';
import { MotionSection } from './sections/motion-section.jsx';

function App() {
  return (
    <div>
      <h1>what-react acceptance</h1>
      <ContextSection />
      <ZustandSection />
      <QuerySection />
      <FormSection />
      <ToastSection />
      <MenuSection />
      <MotionSection />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
