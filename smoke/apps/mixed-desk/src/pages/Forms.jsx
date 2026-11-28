// A react-hook-form form whose submit adds a deal to the store, and the
// events beside each other: a React onChange, a native onInput, and a React
// <form onChange> around a native field.

import { signal } from 'what-framework';

import { addDeal, deals } from '../store.js';
import { DealForm } from '../react/DealForm.jsx';
import { ReactField, FormAround, FancyInput } from '../react/Fields.jsx';
import { NativeField } from '../native-parts.jsx';

export function Forms() {
  const reactCalls = signal(0);
  const reactValue = signal('');
  const nativeCalls = signal(0);
  const nativeValue = signal('');
  const formChanges = signal(0);
  const typedInForm = signal('');
  const fancy = { current: null };
  return (
    <section data-route="forms">
      <h1>Book a deal</h1>
      <DealForm onCreate={addDeal} />
      <p>Newest deal: <b data-newest>{deals()[0].name} · {deals()[0].desk} · {deals()[0].notional}</b></p>
      <h2>Events</h2>
      <div class="fields">
        <ReactField onValue={(v) => { reactCalls(reactCalls() + 1); reactValue(v); }} />
        <input data-native-field placeholder="native field" onInput={(e) => { nativeCalls(nativeCalls() + 1); nativeValue(e.target.value); }} />
        <FormAround onFormChange={() => formChanges(formChanges() + 1)}>
          <NativeField onType={typedInForm} />
        </FormAround>
        <FancyInput ref={fancy} label="Ref'd" />
        <button type="button" data-focus-fancy onClick={() => fancy.current && fancy.current.focus()}>focus the React input from native code</button>
      </div>
      <output data-event-counts>{`react=${reactCalls()}:${reactValue()} native=${nativeCalls()}:${nativeValue()} form=${formChanges()}:${typedInForm()}`}</output>
    </section>
  );
}
