// Intrinsic element handlers type `e.currentTarget` as that element's DOM
// type, as React's types do: the common cases read the element's own members
// with no cast. Compiled by ../../jsx-event-types.test.js; must type-check
// clean under strict mode.
import { signal } from 'what-framework';

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const expect = <T extends true>(_: T) => {};

export function Form() {
  const name = signal('');
  const bio = signal('');
  const plan = signal('free');
  const agreed = signal(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        e.currentTarget.reset();
        expect<Equals<typeof e.currentTarget, EventTarget & HTMLFormElement>>(true);
        expect<Equals<typeof e.submitter, HTMLElement | null>>(true);
        return data;
      }}
    >
      <input value={name()} onInput={(e) => name.set(e.currentTarget.value)} />
      <input type="checkbox" onchange={(e) => agreed.set(e.currentTarget.checked)} />
      <input onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <textarea value={bio()} onInput={(e) => bio.set(e.currentTarget.value.trim())} />
      <select value={plan()} onChange={(e) => plan.set(e.currentTarget.value)}>
        <option value="free">Free</option>
      </select>
      <button type="submit" onClick={(e) => { e.currentTarget.disabled = true; return e.currentTarget.form; }}>Save</button>
      <a href="/x" onClick={(e) => e.currentTarget.href} />
      <div
        onClick={(e) => {
          expect<Equals<typeof e.currentTarget, EventTarget & HTMLDivElement>>(true);
          // `target` stays the element the event started at, not the handler's own.
          expect<Equals<typeof e.target, EventTarget & Element>>(true);
          // A div has no value: the type is the div's, not `any`.
          // @ts-expect-error
          return e.currentTarget.value;
        }}
      />
      <video onPlay={() => {}} onClick={(e) => e.currentTarget.play()} />
      <svg onClick={(e) => e.currentTarget.viewBox}>
        <circle onMouseEnter={(e) => e.currentTarget.r} />
      </svg>
      {/* A handler written for a wider element still fits. */}
      <input onInput={(e: Event) => e.type} />
      <input onBlur={(e: FocusEvent & { currentTarget: Element }) => e.currentTarget.id} />
      {/* A custom element's handler sees an Element. */}
      <my-widget onClick={(e: MouseEvent & { currentTarget: Element }) => e.currentTarget.tagName} />
    </form>
  );
}
