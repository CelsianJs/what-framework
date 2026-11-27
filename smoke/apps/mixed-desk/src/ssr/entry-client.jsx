import { hydrate } from 'what-framework';

import { QuotePage } from './QuotePage.jsx';

const root = document.getElementById('quote');
hydrate(<QuotePage symbol={root.dataset.symbol} />, root);
window.__hydrated = true;
