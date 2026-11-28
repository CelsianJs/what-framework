import { useEffect, useRef, useState } from 'react';
import styled, { ThemeProvider, createGlobalStyle, css, keyframes, useTheme } from 'styled-components';

const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`;
const Global = createGlobalStyle`body { margin: 0; letter-spacing: 1px; }`;
const Button = styled.button`
  padding: 4px 8px;
  border: 0;
  color: ${(p) => (p.$primary ? 'white' : 'black')};
  background: ${(p) => (p.$primary ? p.theme.main : 'white')};
  ${(p) => p.$wide && css`width: 200px;`}
`;
const Big = styled(Button)`font-size: 30px;`;
const Field = styled.input.attrs({ type: 'text', placeholder: 'styled' })`border: 2px solid ${(p) => p.theme.main};`;
const Spinner = styled.div`width: 10px; height: 10px; animation: ${spin} 1s linear infinite;`;

const themes = { red: { main: 'rgb(200, 0, 0)' }, blue: { main: 'rgb(0, 0, 200)' } };
const Item = styled.li`list-style: none; border-left: 3px solid ${(p) => p.theme.main};`;

// Reports the theme it is under from an effect, each time the theme changes.
function ThemeLog({ onTheme }) {
  const theme = useTheme();
  useEffect(() => { onTheme(theme.main); }, [theme]);
  return null;
}

export default function Fixture() {
  const [primary, setPrimary] = useState(true);
  const [theme, setTheme] = useState('red');
  const [text, setText] = useState('');
  const [global, setGlobal] = useState(true);
  const [event, setEvent] = useState('');
  const [seen, setSeen] = useState([]);
  const [tag, setTag] = useState('');
  const [items, setItems] = useState(['a', 'b', 'c']);
  const field = useRef(null);
  // The ref of a styled component is its DOM element, there once it mounted.
  useEffect(() => { setTag(`${field.current.tagName}:${field.current.placeholder}`); }, []);
  return (
    <ThemeProvider theme={themes[theme]}>
      {global ? <Global /> : null}
      <ThemeLog onTheme={(main) => setSeen((list) => [...list, main])} />
      <Button id="sc-btn" $primary={primary} onClick={(e) => { setPrimary(!primary); setEvent(`${e.currentTarget.id}:${e.type}:${typeof e.persist}`); }}>toggle</Button>
      <Big id="sc-big" $primary $wide>big</Big>
      <Button id="sc-link" as="a" href="#x">link</Button>
      <button id="sc-theme" onClick={() => setTheme(theme === 'red' ? 'blue' : 'red')}>theme</button>
      <Field id="sc-field" ref={field} value={text} onChange={(e) => setText(e.target.value)} />
      <span id="sc-text">{text}</span>
      <Spinner id="sc-spin" />
      <button id="sc-focus" onClick={() => field.current.focus()}>focus the field</button>
      <button id="sc-global" onClick={() => setGlobal(!global)}>global style</button>
      <button id="sc-reverse" onClick={() => setItems([...items].reverse())}>reverse</button>
      <span id="sc-event">{event}</span>
      <span id="sc-seen">{seen.join('|')}</span>
      <span id="sc-tag">{tag}</span>
      <ul id="sc-items">
        {items.map((id) => <Item key={id} className="sc-item" data-id={id}><input className="sc-note" defaultValue={id} /></Item>)}
      </ul>
    </ThemeProvider>
  );
}
