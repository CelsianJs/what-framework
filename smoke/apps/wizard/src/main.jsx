// Harbor auto quote: an eight-step quote under one layout. Client-only;
// index.html ships an empty #app.

import './styles.css';

import { mount } from 'what-framework';
import { Router, nestedRoutes } from 'what-router';

import { STEPS } from './data.js';
import { draft, steps } from './draft.js';
import { stepPath } from './step-form.js';
import { QuoteLayout } from './QuoteLayout.jsx';
import { AboutStep } from './steps/About.jsx';
import { AddressStep } from './steps/Address.jsx';
import { VehiclesStep } from './steps/Vehicles.jsx';
import { DriversStep } from './steps/Drivers.jsx';
import { BusinessStep } from './steps/Business.jsx';
import { CoverageStep } from './steps/Coverage.jsx';
import { DocumentsStep } from './steps/Documents.jsx';
import { ReviewStep } from './steps/Review.jsx';
import { DonePage } from './steps/Done.jsx';

const PAGES = {
  about: AboutStep,
  address: AddressStep,
  vehicles: VehiclesStep,
  drivers: DriversStep,
  business: BusinessStep,
  coverage: CoverageStep,
  documents: DocumentsStep,
  review: ReviewStep,
};

// A deep link to a step goes there when every step before it is done. A step
// that does not apply to this draft (Business, without a business vehicle)
// sends the visitor on to the next one that does; an earlier step not done
// yet sends them back to it.
function reachable(id) {
  return () => {
    const list = steps.peek();
    const done = draft.peek().done;
    const at = list.findIndex((s) => s.id === id);
    if (at === -1) {
      const after = STEPS.slice(STEPS.findIndex((s) => s.id === id) + 1).find((s) => list.includes(s));
      return stepPath(after.id);
    }
    const blocked = list.slice(0, at).find((s) => !done[s.id]);
    return blocked ? stepPath(blocked.id) : undefined;
  };
}

function firstOpenStep() {
  const done = draft.peek().done;
  const list = steps.peek();
  return stepPath((list.find((s) => !done[s.id]) ?? list[list.length - 1]).id);
}

const routes = [
  { path: '/', component: () => null, middleware: [firstOpenStep] },
  ...nestedRoutes('/quote', [
    { path: '/', component: () => null, middleware: [firstOpenStep] },
    ...STEPS.map((s) => ({ path: `/${s.id}`, component: PAGES[s.id], middleware: [reachable(s.id)] })),
  ], { layout: QuoteLayout }),
  { path: '/done', component: DonePage },
];

function NotFound() {
  return <p data-not-found>Nothing here. <a href="/quote">Back to your quote</a></p>;
}

mount(<Router routes={routes} fallback={NotFound} />, '#app');
