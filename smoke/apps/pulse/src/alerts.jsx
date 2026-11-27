// Alerts slide in, stay a moment and slide out, each with a CSS transition
// (cssTransition), and leave the list once the exit has run.

import { onCleanup, onMount, signal } from 'what-framework';
import { cssTransition } from 'what-framework/motion';

import { handles, probes } from './probes.js';

const alerts = signal([]);
let seq = 0;

export function raise(text) {
  const id = ++seq;
  alerts((list) => [...list, { id, text }]);
  return id;
}
const remove = (id) => alerts((list) => list.filter((a) => a.id !== id));
handles.alerts = { raise, count: () => alerts.peek().length };

function Alert({ alert }) {
  probes.alertsLive++;
  probes.alertsMade++;
  let el = null;
  let hold = 0;
  let gone = false;
  onMount(() => {
    cssTransition(el, 'alert', 'enter', 120).then(() => {
      if (gone) return;
      probes.alertTimers++;
      hold = setTimeout(() => {
        probes.alertTimers--;
        hold = 0;
        cssTransition(el, 'alert', 'exit', 120).then(() => remove(alert.id));
      }, 150);
    });
  });
  onCleanup(() => {
    gone = true;
    if (hold) {
      clearTimeout(hold);
      probes.alertTimers--;
    }
    probes.alertsLive--;
  });
  return <li class="alert" data-alert={alert.id} ref={(node) => { el = node; }}>{alert.text}</li>;
}

export function Alerts() {
  return (
    <section class="alerts">
      <h2>Alerts <button data-raise onClick={() => raise(`p99 latency over threshold (${new Date().toLocaleTimeString()})`)}>Raise one</button></h2>
      <ol data-alerts>
        {alerts().map((a) => <Alert key={a.id} alert={a} />)}
      </ol>
    </section>
  );
}
