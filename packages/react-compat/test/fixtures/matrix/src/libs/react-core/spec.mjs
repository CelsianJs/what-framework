export default {
  packages: ['react', 'react-dom'],
  exercised: 'React 19 itself, as libraries use it: events through portals, ref callbacks with cleanup, `ref` as a prop, `useImperativeHandle`, context as provider with `use`, `use(promise)` and `lazy` under Suspense, `useTransition` with an async action, `useOptimistic`, `useActionState` with a form `action` and `useFormStatus`, class components (context in the constructor, `shouldComponentUpdate`, `PureComponent`, ref to the instance, `setState` callback), child slots and keys, DOM props and synthetic events, controlled fields (a refused edit, a radio group, a multiple select, an `onChange` on the form, a field that stops being controlled), uncontrolled selects, `useSyncExternalStore`, `useEffectEvent`, `flushSync`, effect order, error boundaries for render and effect errors and for a reducer that throws',
  async run(t) {
    await t.step('an event in a portal reaches the React parent, capture first; stopPropagation stops it', async () => {
      await t.click('#c-portal-btn');
      await t.text('#c-portal', '1/1/0');
      await t.click('#c-portal-stop');
      await t.text('#c-portal', '1/2/1');
    });
    await t.step('refs: a prop, an imperative handle, a callback ref with a cleanup', async () => {
      await t.eval(() => window.coreLog.filter((e) => e.startsWith('attach') || e === 'cleanup').join(','), 'attach:B');
      await t.click('#c-ref-go');
      await t.text('#c-ref', 'plain:function');
      await t.text('#c-handle-n', '1');
      await t.eval(() => window.coreLog.filter((e) => e.startsWith('attach') || e === 'cleanup').join(','), 'attach:B,cleanup');
    });
    await t.step('context: provider forms, use(), a memo that does not block an update', async () => {
      await t.eval(() => [...document.querySelectorAll('.c-theme')].map((s) => s.textContent).join(' '), 'dark:1 dark:2 dark! light:0');
      await t.click('#c-ctx-go');
      await t.eval(() => [...document.querySelectorAll('.c-theme')].map((s) => s.textContent).join(' '), 'blue:1 blue:2 blue! light:0');
    });
    await t.step('Suspense: lazy loads, use(promise) resolves, a sibling stays interactive', async () => {
      await t.text('#c-fallback', 'waiting');
      await t.text('#c-lazy', 'lazy loaded');
      await t.click('#c-sibling');
      await t.text('#c-sibling', 'sibling 1');
      await t.click('#c-resolve');
      await t.text('#c-data', 'resolved');
      await t.gone('#c-fallback');
    });
    await t.step('an async transition: pending and optimistic state, then the real state', async () => {
      await t.click('#c-like');
      await t.text('#c-like', 'like 2 (saving)');
      await t.text('#c-like', 'like 2');
      await t.text('#c-like-seen', '1 2p 2');
    });
    await t.step('a form action with useActionState and useFormStatus; the form resets', async () => {
      await t.fill('#c-form-name', 'ada');
      await t.click('#c-form-submit');
      await t.text('#c-form-submit', 'sending');
      await t.text('#c-form-out', '0::true');
      await t.click('#c-form-release');
      await t.text('#c-form-out', '1:ada:false');
      await t.text('#c-form-submit', 'send');
      await t.value('#c-form-name', '');
    });
    await t.step('class components: context in the constructor, ref to the instance, sCU, PureComponent, callbacks', async () => {
      await t.text('#c-class-n', '0:given:given:1:L');
      await t.click('#c-class-tick');
      await t.text('#c-class-tick', 'parent 1');
      await t.text('#c-class-n', '0:given:given:1:L');
      await t.text('#c-pure', 'same:1');
      await t.click('#c-class-bump');
      await t.text('#c-class-n', '1:given:given:2:L');
      await t.eval(() => window.coreLog.filter((e) => e.startsWith('didUpdate') || e.startsWith('setState')).join(' | '), 'didUpdate 0->1 L | setState callback sees 1:given:given:2:L');
    });
    await t.step('an unkeyed child keeps its slot when a keyed sibling leaves, and after a list', async () => {
      await t.type('#c-slot-input', 'kept');
      await t.type('#c-after-list', 'tail');
      await t.page.locator('.c-row').nth(0).fill('A!');
      await t.click('#c-hint');
      await t.value('#c-slot-input', 'kept');
      await t.click('#c-rows');
      await t.eval(() => [...document.querySelectorAll('.c-row')].map((i) => i.value).join(','), 'd,c,A!,b');
      await t.value('#c-after-list', 'tail');
    });
    await t.step('a keyed child that is all its parent renders is a new component under a new key', async () => {
      await t.type('#c-draft-alone', '!');
      await t.type('#c-draft-fragment', '?');
      await t.value('#c-draft-alone', /!/);
      await t.value('#c-draft-fragment', /\?/);
      await t.eval(() => { window.coreDrafts = [document.querySelector('#c-draft-alone'), document.querySelector('#c-draft-fragment')]; return window.coreLog.filter((e) => e.startsWith('c-draft')).join(' | '); }, 'c-draft-alone mount ada | c-draft-fragment mount ada');
      await t.click('#c-user');
      await t.value('#c-draft-alone', 'draft of grace');
      await t.value('#c-draft-fragment', 'draft of grace');
      await t.eval(() => [document.querySelector('#c-draft-alone') === window.coreDrafts[0], document.querySelector('#c-draft-fragment') === window.coreDrafts[1]].join(), 'false,false');
      await t.eval(() => window.coreLog.filter((e) => e.startsWith('c-draft')).slice(2).sort().join(' | '), 'c-draft-alone mount grace | c-draft-alone unmount ada | c-draft-fragment mount grace | c-draft-fragment unmount ada');
    });
    await t.step('DOM props', async () => {
      await t.eval(() => { const el = document.querySelector('#c-styled'); return [el.className, el.style.width, el.style.opacity, el.style.getPropertyValue('--gap'), el.style.lineHeight, el.style.marginTop, el.getAttribute('data-flag'), el.getAttribute('aria-hidden'), el.getAttribute('aria-busy'), el.getAttribute('tabindex'), el.hasAttribute('hidden'), el.getAttribute('draggable'), el.innerHTML].join('|'); }, 'one two|120px|0.5|4px|2|3px|false|false|true|-1|false|true|<i>raw</i>');
      await t.eval(() => { const c = document.querySelector('#c-svg circle'); return [document.querySelector('#c-svg').getAttribute('viewBox'), c.getAttribute('stroke-width'), c.getAttribute('fill-opacity'), c.getAttribute('class'), c.namespaceURI.endsWith('svg')].join('|'); }, '0 0 10 10|2|0.5|dot|true');
      await t.eval(() => document.querySelector('#c-label').htmlFor === document.querySelector('[data-testid="c-id-input"]').id && document.querySelector('#c-label').htmlFor.length > 0, true, 'useId links the label');
    });
    await t.step('controlled fields refuse an edit the handler does not take', async () => {
      await t.click('#c-digits');
      await t.type('#c-digits', 'c1d');
      await t.value('#c-digits', 'abcd');
      await t.text('#c-text', 'abcd');
      await t.click('#c-locked');
      await t.eval(() => document.querySelector('#c-locked').checked, false);
      await t.click('#c-unlock');
      await t.eval(() => document.querySelector('#c-locked').checked, true);
    });
    await t.step('fields: a radio group and a multiple select as their props say, an onChange on the form, a field that stops being controlled', async () => {
      const selected = (sel) => t.page.evaluate((s) => [...document.querySelector(s).selectedOptions].map((o) => o.value).join(''), sel);
      const radios = () => t.page.evaluate(() => document.querySelector('#c-radio-x').checked + ':' + document.querySelector('#c-radio-y').checked);
      await t.until(() => selected('#c-multi'), (v) => v === 'bc', 'the multiple select shows its value');
      // Uncontrolled selects: the first option, or the default value.
      await t.eval(() => document.querySelector('#c-plain').value + document.querySelector('#c-default').value, 'ab');
      // A click the handler refuses leaves the group as it was.
      await t.click('#c-radio-y');
      await t.until(radios, (v) => v === 'true:false', 'the refused radio click is undone');
      await t.click('#c-radio-unlock');
      await t.click('#c-radio-y');
      await t.until(radios, (v) => v === 'false:true', 'the radio click is taken');
      // The handler never takes "a".
      await t.page.selectOption('#c-multi', ['a', 'c']);
      await t.until(() => selected('#c-multi'), (v) => v === 'c', 'the multiple select shows the state again');
      // A controlled field with no handler of its own: the form's takes each keystroke.
      await t.click('#c-form-first');
      await t.type('#c-form-first', 'bc');
      await t.value('#c-form-first', 'abc');
      await t.text('#c-fields-out', 'y:c:abc:2');
      await t.click('#c-uncontrol');
      await t.value('#c-switch', 'kept');
      await t.click('#c-switch');
      await t.type('#c-switch', '!');
      await t.value('#c-switch', 'kept!');
    });
    await t.step('synthetic events: focus and blur bubble with React types, double click, key', async () => {
      await t.page.focus('#c-dbl');
      await t.press('x');
      await t.page.dblclick('#c-dbl');
      await t.text('#c-events', /focus:focus:c-digits blur:blur focus:focus:c-locked.*focus:focus:c-dbl key:x:KeyboardEvent dbl$/);
    });
    await t.step('useSyncExternalStore, a transition, useDeferredValue, useEffectEvent', async () => {
      await t.page.evaluate(() => window.coreStore.set(7));
      await t.text('#c-store', '7');
      await t.click('#c-query');
      await t.text('#c-deferred', 'ab/ab');
      await t.eval(() => window.coreLog.filter((e) => e.startsWith('event sees')).join(','), 'event sees 0,event sees 5');
    });
    await t.step('flushSync renders before it returns', async () => {
      await t.click('#c-sync');
      await t.text('#c-sync-out', '6');
    });
    await t.step('effect order: child before parent, layout before passive, cleanups on unmount', async () => {
      await t.eval(() => window.coreLog.filter((e) => /^(layout|effect) (child|parent)$/.test(e)).slice(0, 4).join(' | '), 'layout child | layout parent | effect child | effect parent');
      await t.page.evaluate(() => { window.coreLog.length = 0; });
      await t.click('#c-unmount');
      await t.eval(() => window.coreLog.filter((e) => e.includes('cleanup')).sort().join(' | '), 'effect cleanup child | effect cleanup parent | layout cleanup child | layout cleanup parent');
    });
    await t.step('Children, cloneElement, Profiler and StrictMode', async () => {
      await t.text('#c-children', '3:4:true');
      await t.attr('#c-cloned', 'class', 'new');
      await t.attr('#c-cloned', 'href', '#old');
      await t.text('#c-wrapped', 'wrapped');
    });
    await t.step('error boundaries catch a render error and an effect error', async () => {
      await t.click('#c-throw-render');
      await t.text('#c-err-render', 'caught render');
      await t.click('#c-throw-effect');
      await t.text('#c-err-effect', 'caught effect');
      await t.click('#c-throw-reducer');
      await t.text('#c-err-reducer', 'caught reducer');
    });
    await t.step('a component that suspends after it mounted keeps its state', async () => {
      await t.click('#c-keep');
      await t.click('#c-keep');
      await t.text('#c-keep', 'kept 2');
      await t.click('#c-suspend');
      await t.text('#c-keep-fallback', 'suspended');
      await t.click('#c-resume');
      await t.text('#c-keep', 'kept 2');
    });
  },
};
