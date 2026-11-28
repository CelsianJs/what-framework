import { h } from 'what-framework';
import { renderToHydratableString } from 'what-framework/server';

import { QuotePage } from './QuotePage.jsx';

export function render(symbol) {
  return renderToHydratableString(h(QuotePage, { symbol }));
}
