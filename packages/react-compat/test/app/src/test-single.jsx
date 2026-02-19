import { createRoot } from 'react-dom/client';
import { RadixSuiteTest as Test } from './test-radix-suite.jsx';
const root = createRoot(document.getElementById('app'));
root.render(<div style={{ fontFamily: 'system-ui', padding: '2rem' }}><Test /></div>);
