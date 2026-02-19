import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';

const codeString = `function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));`;

function TestComponent() {
  return (
    <SyntaxHighlighter
      language="javascript"
      style={atomOneDark}
      customStyle={{ borderRadius: 4, fontSize: 11, padding: 8 }}
    >
      {codeString}
    </SyntaxHighlighter>
  );
}

TestComponent.packageName = 'react-syntax-highlighter';
TestComponent.downloads = '4.3M/week';
export default TestComponent;
