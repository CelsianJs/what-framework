// Pulse: a service-health wall where something moves every frame. Client-only;
// index.html ships an empty #app.

import './styles.css';

import { mount } from 'what-framework';

import { Alerts } from './alerts.jsx';
import { Chart } from './chart.jsx';
import { Gauge } from './gauge.jsx';
import { Panel } from './panel.jsx';
import { RefreshRing } from './ring.jsx';

function App() {
  return (
    <main class="wall">
      <header><h1>Pulse</h1><p class="muted">checkout-api · production</p></header>
      <Chart />
      <div class="row">
        <Gauge />
        <RefreshRing />
        <Panel />
      </div>
      <Alerts />
    </main>
  );
}

mount(<App />, '#app');
