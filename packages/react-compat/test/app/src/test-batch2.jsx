/**
 * Batch 2 test — 15 additional React libraries
 * Navigate to /test-batch2.html
 */
import { createRoot } from 'react-dom/client';
import { LucideTest } from './test-lucide.jsx';
import { ReduxTest } from './test-redux.jsx';
import { SonnerTest } from './test-sonner.jsx';
import { DropzoneTest } from './test-dropzone.jsx';
import { ColorfulTest } from './test-colorful.jsx';
import { NumberFormatTest } from './test-numberformat.jsx';
import { SyntaxTest } from './test-syntax.jsx';
import { FloatingTest } from './test-floating.jsx';
import { TextareaTest } from './test-textarea.jsx';
import { DayPickerTest } from './test-daypicker.jsx';
import { EmblaTest } from './test-embla.jsx';
import { PanelsTest } from './test-panels.jsx';
import { EmotionTest } from './test-emotion.jsx';
import { StyledTest } from './test-styled.jsx';
import { ReactDndTest } from './test-reactdnd.jsx';

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
      <h1>what-react Batch 2 — 15 More Libraries</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        Testing libraries 21-35 for React compatibility
      </p>

      <Section num={21} title="Lucide React (Icons)"><LucideTest /></Section>
      <Section num={22} title="Redux Toolkit + React-Redux (State)"><ReduxTest /></Section>
      <Section num={23} title="Sonner (Toast Notifications)"><SonnerTest /></Section>
      <Section num={24} title="React Dropzone (File Upload)"><DropzoneTest /></Section>
      <Section num={25} title="React Colorful (Color Picker)"><ColorfulTest /></Section>
      <Section num={26} title="React Number Format (Inputs)"><NumberFormatTest /></Section>
      <Section num={27} title="React Syntax Highlighter (Code)"><SyntaxTest /></Section>
      <Section num={28} title="Floating UI (Positioning)"><FloatingTest /></Section>
      <Section num={29} title="React Textarea Autosize (Forms)"><TextareaTest /></Section>
      <Section num={30} title="React Day Picker (Date Picker)"><DayPickerTest /></Section>
      <Section num={31} title="Embla Carousel (Carousel)"><EmblaTest /></Section>
      <Section num={32} title="React Resizable Panels (Layout)"><PanelsTest /></Section>
      <Section num={33} title="Emotion Styled (CSS-in-JS)"><EmotionTest /></Section>
      <Section num={34} title="Styled Components (CSS-in-JS)"><StyledTest /></Section>
      <Section num={35} title="React DnD (Drag & Drop)"><ReactDndTest /></Section>
    </div>
  );
}

const root = createRoot(document.getElementById('app'));
root.render(<App />);
