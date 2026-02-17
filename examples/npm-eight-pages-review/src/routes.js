import RootLayout from './pages/_layout.jsx';
import HomePage from './pages/index.jsx';
import SignalsPage from './pages/signals.jsx';
import ListsPage from './pages/lists.jsx';
import FormsPage from './pages/forms.jsx';
import DataPage from './pages/data.jsx';
import StorePage from './pages/store.jsx';
import FocusPage from './pages/focus.jsx';
import HtmlPage from './pages/html.jsx';

const withLayout = (path, component) => ({
  path,
  component,
  layout: RootLayout,
});

export const routes = [
  withLayout('/', HomePage),
  withLayout('/signals', SignalsPage),
  withLayout('/lists', ListsPage),
  withLayout('/forms', FormsPage),
  withLayout('/data', DataPage),
  withLayout('/store', StorePage),
  withLayout('/focus', FocusPage),
  withLayout('/html', HtmlPage),
];
