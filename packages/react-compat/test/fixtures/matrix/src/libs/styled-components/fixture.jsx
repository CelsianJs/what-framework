import { useState } from 'react';
import styled, { ThemeProvider, createGlobalStyle, css, keyframes } from 'styled-components';

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

export default function Fixture() {
  const [primary, setPrimary] = useState(true);
  const [theme, setTheme] = useState('red');
  const [text, setText] = useState('');
  return (
    <ThemeProvider theme={themes[theme]}>
      <Global />
      <Button id="sc-btn" $primary={primary} onClick={() => setPrimary(!primary)}>toggle</Button>
      <Big id="sc-big" $primary $wide>big</Big>
      <Button id="sc-link" as="a" href="#x">link</Button>
      <button id="sc-theme" onClick={() => setTheme(theme === 'red' ? 'blue' : 'red')}>theme</button>
      <Field id="sc-field" value={text} onChange={(e) => setText(e.target.value)} />
      <span id="sc-text">{text}</span>
      <Spinner id="sc-spin" />
    </ThemeProvider>
  );
}
