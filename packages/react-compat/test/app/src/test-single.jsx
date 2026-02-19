/**
 * Single library tester — swap the import to test each lib individually.
 * Navigate to /test-single.html to use this.
 */
import { createRoot } from 'react-dom/client';

// Uncomment ONE at a time to test:
import { RechartsTest as Test } from './test-recharts.jsx'; // INVESTIGATING
// import { SelectTest as Test } from './test-select.jsx'; // ERRORS
// import { VirtualTest as Test } from './test-virtual.jsx'; // WORKS
// import { I18nTest as Test } from './test-i18n.jsx'; // WORKS
// import { HeadlessTest as Test } from './test-headless.jsx'; // WORKS
// import { DatePickerTest as Test } from './test-datepicker.jsx'; // CLASS CTOR
// import { ToastifyTest as Test } from './test-toastify.jsx'; // WORKS
// import { HelmetTest as Test } from './test-helmet.jsx'; // WORKS

const root = createRoot(document.getElementById('app'));
root.render(<div style={{ fontFamily: 'system-ui', padding: '2rem' }}><Test /></div>);
