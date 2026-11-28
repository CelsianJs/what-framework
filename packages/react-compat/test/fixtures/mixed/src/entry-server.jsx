import { h } from 'what-framework';
import { renderToHydratableString } from 'what-framework/server';
import { Dashboard } from './Dashboard.jsx';

export function render() {
  return renderToHydratableString(h(Dashboard));
}
