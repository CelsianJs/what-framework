import { Dashboard } from './pages/Dashboard.jsx';
import { Deals } from './pages/Deals.jsx';
import { Forms } from './pages/Forms.jsx';
import { Overlays } from './pages/Overlays.jsx';
import { Motion } from './pages/Motion.jsx';
import { Upload } from './pages/Upload.jsx';
import { Tools } from './pages/Tools.jsx';

function About() {
  return (
    <section data-route="about">
      <h1>About this desk</h1>
      <p>The shell, the routes and the store are What. Each screen still uses the React libraries it was built with.</p>
    </section>
  );
}

export function NotFound() {
  return <section data-route="404"><h1>No such screen</h1></section>;
}

export const routes = [
  { path: '/', component: Dashboard },
  { path: '/deals', component: Deals },
  { path: '/forms', component: Forms },
  { path: '/overlays', component: Overlays },
  { path: '/motion', component: Motion },
  { path: '/upload', component: Upload },
  { path: '/tools', component: Tools },
  { path: '/about', component: About },
];
