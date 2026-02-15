# Junior Developer Review -- What Framework

> Reviewer: Junior Frontend Dev, ~2 years experience, mostly React/Next.js.
> Date: 2026-02-10
> Time spent: ~6 hours reading docs, source, and mentally building apps.

---

## First Impressions

The README is genuinely exciting on first read. "The closest framework to vanilla JS" is a great tagline -- it immediately tells me this is trying to be lightweight and close to the metal. The counter example at the top is concise and I can kind of read it. The feature table is impressive: signals, islands, SSR, forms, data fetching, animations, a11y... all in ~4kB? That sounds too good to be true, and honestly, that is my first red flag. It feels like it is trying to be everything at once.

My honest gut reaction: "This looks cool, but do I trust a framework that claims to do everything React does plus more, in 1/10th the size?" I would need to see it actually work before I believe it.

---

## The Learning Journey

### Minute 1-5: Reading the README

**What made sense:**
- The tagline and positioning are clear. I get it: lightweight, signals, no virtual DOM.
- The counter example is readable enough. I can see `signal(0)` is like `useState(0)` but different syntax.
- The `useState` compatibility example is reassuring -- "oh I can use what I already know."
- Bundle size comparison table is compelling.
- `npx create-what my-app` -- standard, no surprises.

**What confused me:**
- The very first code example uses `signal()` but the "Familiar API" section shows `useState`. Which one am I supposed to use? This is the first thing I read and I already do not know which approach to take.
- `h('div', null, ...)` -- I know this is `React.createElement` under the hood, but I have never written it by hand. Seeing `null` as the second argument for "no props" feels ugly. In React I write JSX and never think about this.
- `() => count()` as a child of `h()` -- why is there a function wrapper around reading the signal? I would not understand this without reading more docs. The README does not explain why the arrow function is needed. This is a critical gotcha that is buried.
- Islands example uses `import { Island, island } from 'what/server'` -- wait, is `island` (lowercase) a function and `Island` (uppercase) a component? That naming collision would trip me up.
- The README says "~4kB gzipped for the full runtime" but the QUICKSTART shows individual sizes totaling ~3.8kB. Small inconsistency but it would make me question whether the numbers are accurate.

### Minute 5-30: Quick Start

Walking through the QUICKSTART guide...

**Project scaffolding (`npx create-what my-app`):**
I looked at `create-what/index.js` and it generates a reasonable project. The generated `app.js` uses the router right away, which is nice -- it shows best practices from the start. But the generated code imports from `'what'` and `'what/router'`, while the demo app imports from `'@what/core'` and `'@what/router'`. This is immediately confusing. Which is the correct import path? The README says `import from 'what'`, the scaffolder says `import from 'what'`, but every demo file says `@what/core`. Are these aliases? Is one for development and one for production? The DEVELOPMENT.md explains the CLI rewrites `'what'` to `'/@what/core.js'`, but I would not find that for a while.

**Running the dev server:**
The DEVELOPMENT.md shows two options for local development -- `npm link` and file references. Neither is `npx create-what my-app && npm install && npm run dev`. Since the packages are not published to npm, I literally cannot do the standard flow. For a real evaluation, I would get stuck right here. The scaffolder generates `"what": "^0.1.0"` in package.json, but that package does not exist on npm. I would `npm install` and get an error immediately.

This is the single biggest onboarding problem: **the framework cannot actually be installed yet.** I understand this is pre-release, but the docs present it as if `npx create-what` works end-to-end. It does not.

**"Your First Component" section:**
This uses `useState` -- great, I know this. But wait, the top of the README used `signal`. And the "Signals (The Core Primitive)" section immediately follows and teaches signals. So within the first page of the quickstart, I have been shown two different ways to manage state. I would be asking: "When do I use `useState` vs `signal` vs `useSignal`?" and I would not find a clear answer.

### Hour 1-3: Building My First App

Mentally building a todo app, following the README example...

**Step 1: Copy the Todo example from the README.**
It uses `signal`, `computed`, and `h()`. The code is 30 lines. In React with JSX, this would be about the same length but much more readable. The deeply nested `h()` calls are hard to visually parse. I count the commas and parentheses and lose track of what is nested inside what.

**Step 2: Try to add a "clear completed" button.**
I need to filter out done items: `todos.set(t => t.filter(item => !item.done))`. Okay, that works the same as React. Fine.

**Step 3: Try to add filter buttons (all/active/done).**
This already exists in the example. I notice `filter` is a `signal` and `filtered` is a `computed`. The mental model here is nice -- `computed` automatically recomputes when its dependencies change. In React I would use `useMemo` with a dependency array, and I would definitely forget to add `filter` to the deps. So this is actually better.

**Step 4: Add persistence with localStorage.**
The API docs mention `useLocalStorage`. But wait -- is that a hook or a utility? Can I use it outside a component? Looking at the source, it is exported from `helpers.js`. There is no clear guidance on "hooks must be inside components, utilities can be anywhere." This distinction matters and it is not documented.

**Where I got stuck:**
- The `h()` nesting. Seriously. Building anything beyond a simple component becomes a pyramid of doom. The todo list example is already hard to read, and it is a simple app.
- Understanding when to use `() => count()` vs just `count` as a child. The README example wraps signal reads in arrow functions when they are text children: `h('p', null, 'Count: ', () => count())`. But in the QUICKSTART counter, it just uses `count` directly: `h('span', { class: 'count' }, count)`. Which is correct? Do both work? When? This inconsistency across docs would drive me crazy.
- The todo example in the README uses `signal()` directly, but the demo app's TodoList uses `useState()`. These are two completely different patterns for the same thing. I would spend an hour trying to figure out which is "right."

### Day 1: Going Deeper

**Routing:**
The routing API is actually nice. `defineRoutes` with a simple object is clean. `Link` component works as expected. File-based routing with `[id].js` for dynamic params is familiar from Next.js. I would be comfortable with this within an hour.

But: the router imports from `'what/router'` while the demo imports from `'@what/router'`. Again, which is it? And the router source code has `import { signal, effect } from '../../core/src/index.js'` -- relative path imports between packages. This means the packages are not truly standalone. If I were trying to understand the codebase, this internal coupling would confuse me.

**Data fetching:**
Three options: `useFetch`, `useSWR`, `useQuery`. Why three? `useFetch` is a basic wrapper. `useSWR` adds caching. `useQuery` adds retries, stale time, cache time, pagination. Coming from React, I would be used to picking between `fetch`, `SWR`, or `TanStack Query` -- all separate libraries. Here they are all built in. That is nice in theory, but it means the framework is making choices for me that might be wrong. What if `useSWR` has a bug? In the React ecosystem, I would switch libraries. Here, I am stuck.

The API for `useSWR` looks almost identical to the real `swr` library, which is good for migration. But looking at the implementation, there are some concerning things: the global `cache` is a plain `Map` with no size limits, no TTL cleanup, and no garbage collection. For a real app with lots of data, this would be a memory leak. A junior like me would not catch this until production.

**Forms:**
`useForm` looks very similar to `react-hook-form`. The `register` function, `handleSubmit`, `formState` -- it is all familiar. The `simpleResolver` with built-in `rules` is a nice touch. In React, I would need to install `react-hook-form` and `zod` separately, then wire up `zodResolver`. Here it is all one import. That is genuinely nice.

But: the form in the demo uses `formState.errors().email` -- those parentheses after `errors` are because it is a signal function, right? That is confusing. In react-hook-form, `formState.errors.email` is just a property access. The signal wrapping means I have to remember to call it as a function. I would forget this constantly and get `undefined` instead of my errors object.

---

## Building Real Things (Compared to React)

### Counter (Hello World)

**What Framework:**
```js
import { h, mount, signal } from 'what';

function Counter() {
  const count = signal(0);
  return h('div', null,
    h('p', null, 'Count: ', () => count()),
    h('button', { onClick: () => count.set(c => c + 1) }, '+'),
  );
}
mount(h(Counter), '#app');
```

**React:**
```jsx
import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>+</button>
    </div>
  );
}
```

**Verdict:** React is more readable because of JSX. But the What version is shorter and I can see how signals avoid the stale closure problem. `count.set(c => c + 1)` is cleaner than `setCount(c => c + 1)` -- the method call on the signal object is intuitive. But `() => count()` as a child is strange. Why do I need a function that calls a function?

### Todo List

**What I would struggle with:**
- Nesting `h()` calls for the input, button, list, and list items. By the time I have a todo with a checkbox, text, and delete button inside an `li` inside a `ul`, I am 6 levels deep in `h()` calls and lost track of my commas.
- The demo version uses `...todos.map(todo => h('li', ...))` with a spread. The README version uses `() => filtered().map(...)` with a function wrapper. These are different patterns and I am unsure which is correct for reactive updates.
- Deciding between `useState` (demo style) and `signal` (README style). The demo TodoList uses `useState` for everything, which is comfortable, but the README pushes signals. Mixed signals (pun intended).

**What is nice:**
- `computed()` for derived state is genuinely better than `useMemo` with manual deps. I would love this.
- No dependency arrays to get wrong. In React, forgetting a dep in `useEffect` is my number one source of bugs. Signals track automatically.
- The todo code is roughly the same amount of code as React, just formatted differently.

### User Profile with Data Fetching

**How I would build it:**
```js
import { h, useSWR, Skeleton, show } from 'what';

function UserProfile({ userId }) {
  const { data, error, isLoading } = useSWR(
    `user-${userId}`,
    () => fetch(`/api/users/${userId}`).then(r => r.json())
  );

  if (isLoading()) return h(Skeleton, { height: 200 });
  if (error()) return h('p', null, 'Error loading user');

  return h('div', null,
    h('img', { src: () => data().avatar }),
    h('h2', null, () => data().name),
  );
}
```

**Confusion points:**
- `isLoading()` -- is that a function call? Yes, it is a computed signal. But `isLoading` in SWR (the real library) is a boolean. I would write `if (isLoading)` (without parentheses) first, get `true` (because a function is truthy), and wonder why my loading state never goes away. This would be a 30-minute debugging session.
- `data()` returns the data or null. But I need `() => data().avatar` in props because... reactivity? What if `data()` is null? Then `data().avatar` throws. The README example has this exact pattern. In React, I would do conditional rendering first, so by the time I access `data`, I know it exists. Here, the `if (isLoading())` guard should protect me, but the reactive function wrapper makes it less obvious.
- `show(isLoading, ...)` vs `if (isLoading()) return ...` -- the docs show both patterns. Which is idiomatic?

### Form with Validation

The `useForm` API is comfortable because it mirrors `react-hook-form`. I would be productive here within an hour.

**Pain points:**
- `register('email')` returns an object that I spread onto the input: `{ ...register('email') }`. This is the same as react-hook-form, so no surprises. Good.
- `formState.errors().email?.message` -- the `()` after `errors` is the signal call. I would forget this.
- `show(formState.errors().email, h('span', ...))` -- so `show` takes a truthy value and conditionally renders? But `formState.errors()` returns the whole object... `formState.errors().email` gets the specific field error... and that is truthy if the error exists. Okay, this works, but it took me a minute to trace through.
- The form demo has inline styles on everything. There is no mention of a recommended styling approach in the quickstart. I would be lost on how to style a real form.

### Multi-page App

**Router experience:**
This is actually good. `defineRoutes` is clean:

```js
const routes = defineRoutes({
  '/': Home,
  '/about': About,
  '/users/:id': UserProfile,
});
```

`Link` component works as expected. `navigate()` for programmatic navigation. Route params via `route.params`. This is all familiar and well-designed.

**Pain points:**
- The `guard()` function returns a higher-order component. I would need to study this for a while. The API docs show `guard(check, fallback)` but do not clearly show how to apply it to a route.
- `route.path` vs `route.params` -- are these reactive? The source shows they are getters on signals. So `route.path` auto-tracks. That is nice but non-obvious. In Next.js, `useRouter()` returns a plain object. Here, accessing `route.path` in an effect would automatically re-run the effect when the path changes. Powerful, but I would not realize this without reading the source.
- View Transitions are cool but I would not know what they are or when to use them.

---

## Pain Points (Ranked by Frustration)

1. **The `h()` function is painful for anything beyond trivial components.** Writing `h('div', { class: 'card' }, h('div', { class: 'card-header' }, h('h2', null, title), h('p', null, subtitle)))` is genuinely hard to read and write. I would make comma/parenthesis errors constantly. This is the number one reason I would hesitate to adopt this framework. JSX exists for a reason. The fact that there is no JSX option (no compiler) means I am writing `h()` calls for every single element forever. The `html` tagged template is mentioned once in the API docs and then never shown in any example.

2. **`signal()` vs `useState()` vs `useSignal()` -- three ways to do the same thing.** The docs never clearly explain when to use which. The README uses `signal()`, the QUICKSTART uses `useState()`, the demo uses both interchangeably. This is the second biggest onboarding problem. My suggestion: pick one for the docs and mention the others as alternatives. If you are targeting React devs, lead with `useState`.

3. **The `() => value()` reactive wrapper pattern is not explained.** In the README counter, `() => count()` wraps the signal read so the DOM updates reactively. But this pattern is never explicitly taught. I discovered it by reading examples. When do I need the outer arrow function? Always for text children? What about props? The `style` prop uses `style: () => ({...})` for reactivity but `class` is just a string. The rules are inconsistent and undocumented.

4. **Import path confusion: `'what'` vs `'@what/core'` vs `'@aspect/core'`.** The public API says `import from 'what'`. The demo uses `@what/core`. The package is actually named `@aspect/core`. The CLI rewrites imports. This is three different names for the same thing and it is deeply confusing during development.

5. **Cannot actually install and run it.** The packages are not published to npm. `npx create-what my-app && npm install` would fail. The DEVELOPMENT.md explains workarounds, but the README and QUICKSTART present it as ready-to-use. This breaks the first-run experience entirely.

6. **Too many APIs for a 4kB framework.** The `index.js` exports over 100 symbols. `signal`, `computed`, `effect`, `batch`, `untrack`, `h`, `Fragment`, `html`, `mount`, `useState`, `useSignal`, `useComputed`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useContext`, `useReducer`, `createContext`, `onMount`, `onCleanup`, `createResource`, `memo`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`, `createStore`, `atom`, `Head`, `show`, `each`, `cls`, `style`, `debounce`, `throttle`, `useMediaQuery`, `useLocalStorage`, `Portal`, `transition`... and that is just core. Plus animation, a11y, skeleton, data, and form modules. It is overwhelming.

7. **Inconsistent examples across docs.** The README counter uses `signal()`. The QUICKSTART counter uses `useState()`. The demo counter uses `useState()`. The API docs show both. Each doc file seems to have been written with a different mental model of the "right" way to use the framework.

8. **No error messages guidance.** What happens when I call a hook outside a component? The source says `throw new Error('Hooks must be called inside a component')`. That is fine. But what about when I forget the `() =>` wrapper and my UI does not update? No error. Silent failure. I would stare at my code for an hour wondering why the counter displays `[Function]` or never updates.

---

## Things That Are Actually Better Than React

1. **No dependency arrays.** Signals auto-track dependencies. I will never again forget to add `count` to my `useEffect` deps. `computed(() => count() * 2)` just works. This is genuinely superior and would save me hours of debugging.

2. **Fine-grained updates without memoization.** In React, I write `React.memo`, `useMemo`, `useCallback` everywhere to avoid unnecessary re-renders. Here, signals update only the exact DOM nodes that read them. No memoization ceremony needed. The `memo()` function exists but is rarely needed.

3. **`useForm` built in.** Not needing to install, configure, and learn `react-hook-form` separately is a real DX win. The API is similar enough that I could be productive immediately.

4. **`useSWR` built in.** Same reasoning. Not needing a separate data fetching library is convenient.

5. **Bundle size.** 4kB is genuinely impressive. My React + react-dom + router + form library + SWR stack is easily 100kB+. For performance-sensitive sites, this matters.

6. **Islands architecture built in.** In React, I need Next.js or Astro to get partial hydration. Here it is a first-class concept. The hydration modes (idle, visible, action) are well-designed and the API is simple.

7. **`computed()` is lazy.** It only recomputes when read. In React, `useMemo` runs on every render where deps change, even if the memoized value is never used. Lazy evaluation is smarter.

8. **`createStore` is simple.** Compared to Redux (which I have used and hate) or Zustand (which is nice but another dependency), the built-in store is clean:
   ```js
   const useAuth = createStore({
     user: null,
     isLoggedIn: (state) => state.user !== null,
     login(userData) { this.user = userData; },
   });
   ```
   That is it. No actions, reducers, selectors, or middleware to learn.

---

## Confusing Concepts

1. **When to use `signal()` vs `useState()` vs `useSignal()`:** All three manage state. `signal()` is the raw primitive. `useState()` wraps a signal in a `[value, setter]` tuple for React compatibility. `useSignal()` returns the raw signal but ties it to a component lifecycle. I need a clear decision tree: "If you are coming from React, use `useState`. If you want more control, use `useSignal`. Only use raw `signal()` for global state outside components."

2. **Reactive function wrappers in `h()` children:** When do I need `() => count()` vs just `count`? The answer (from reading source code) is: if you pass a function as a child, the framework calls it reactively when signals inside it change. If you pass a value, it is captured once and never updates. This is **critical** knowledge and it is not in the docs.

3. **`show()` function vs `Show` component:** The helpers module exports a `show()` function. The components module exports a `Show` component. They do the same thing differently. `show(condition, vnode)` vs `h(Show, { when: condition }, children)`. Which is preferred? Are they interchangeable?

4. **`each()` function vs `For` component vs `.map()`:** Three ways to render lists. The README uses `.map()` inside a reactive wrapper. The helpers export `each()`. The components export `For`. When and why would I choose one over another?

5. **Signal reading semantics:** `count()` reads and tracks. `count.peek()` reads without tracking. When would I use `peek()`? The docs mention it but do not explain the use case. (Answer from experience: inside event handlers where you do not want to subscribe, but this is an advanced concept for a junior.)

6. **`batch()` and `untrack()`:** These are escape hatches for the signal system. I understand `batch` conceptually (group updates, run effects once). But `untrack` is more nuanced -- it lets you read a signal without subscribing. I would not know when I need this for at least a month.

7. **Islands vs regular components:** When should something be an island vs a regular component? The docs explain what islands are but not the decision process. If I am building a client-side SPA, do I even need islands? If I am doing SSR, should everything interactive be an island?

---

## The h() Function Reality

This is the elephant in the room. Let me be brutally honest.

**Writing `h()` calls all day is miserable for building real UIs.**

Here is a realistic component -- a user profile card:

```js
function UserCard({ user }) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-header' },
      h('img', { src: user.avatar, class: 'avatar', alt: user.name }),
      h('div', { class: 'card-header-text' },
        h('h3', { class: 'card-title' }, user.name),
        h('p', { class: 'card-subtitle' }, user.role),
      ),
    ),
    h('div', { class: 'card-body' },
      h('p', null, user.bio),
      h('div', { class: 'card-stats' },
        h('span', null, user.followers, ' followers'),
        h('span', null, user.following, ' following'),
      ),
    ),
    h('div', { class: 'card-footer' },
      h('button', { class: 'btn btn-primary', onClick: () => follow(user.id) }, 'Follow'),
      h('button', { class: 'btn btn-secondary', onClick: () => message(user.id) }, 'Message'),
    ),
  );
}
```

Now here is the same thing in JSX:

```jsx
function UserCard({ user }) {
  return (
    <div className="card">
      <div className="card-header">
        <img src={user.avatar} className="avatar" alt={user.name} />
        <div className="card-header-text">
          <h3 className="card-title">{user.name}</h3>
          <p className="card-subtitle">{user.role}</p>
        </div>
      </div>
      <div className="card-body">
        <p>{user.bio}</p>
        <div className="card-stats">
          <span>{user.followers} followers</span>
          <span>{user.following} following</span>
        </div>
      </div>
      <div className="card-footer">
        <button className="btn btn-primary" onClick={() => follow(user.id)}>Follow</button>
        <button className="btn btn-secondary" onClick={() => message(user.id)}>Message</button>
      </div>
    </div>
  );
}
```

The JSX version is:
- Easier to read (HTML-like structure is visual)
- Easier to see nesting (indentation matches DOM structure)
- Harder to get wrong (no comma/parenthesis counting)
- Familiar to anyone who knows HTML

The `h()` version requires mental parsing of function calls and careful comma placement. One missing comma or misplaced parenthesis and the whole component breaks, likely with an unhelpful error about unexpected tokens.

**The `html` tagged template** is mentioned in the API docs but never shown in real examples. If it works like Preact's `htm`, it could be a viable middle ground. But the framework does not promote it. Every single example in every doc file uses `h()`.

**My honest recommendation:** If this framework does not get JSX support (via a Babel/SWC plugin or similar), adoption will be severely limited. The `h()` function is fine for small examples and library internals. It is not acceptable as the primary authoring experience for building real UIs.

---

## API Surface Overwhelm

The framework exports approximately 120+ symbols from the core package alone. For comparison, React's core exports about 20.

**What should be in core:**
- `signal`, `computed`, `effect`, `batch`, `untrack`
- `h`, `Fragment`, `mount`
- `useState`, `useEffect`, `useMemo`, `useCallback`, `useRef`, `useReducer`, `useContext`, `createContext`
- `show`, `each`, `cls`
- `memo`, `lazy`, `Suspense`, `ErrorBoundary`

That is about 25 exports. Everything else should be separate packages or optional imports.

**What should be separate packages or opt-in imports:**
- Animation (`spring`, `tween`, `easings`, `useGesture`) -- `what/animation`
- Accessibility (`useFocusTrap`, `announce`, `SkipLink`, etc.) -- `what/a11y`
- Skeleton loaders (`Skeleton`, `SkeletonText`, etc.) -- `what/skeleton`
- Data fetching (`useSWR`, `useQuery`, `useFetch`) -- `what/data`
- Forms (`useForm`, `rules`, resolvers) -- `what/form`
- DOM Scheduler (`scheduleRead`, `scheduleWrite`, etc.) -- `what/scheduler`
- Store (`createStore`, `atom`) -- `what/store`
- Head management (`Head`) -- `what/head`

The claim of "~4kB gzipped" becomes questionable when the core includes animation, a11y, skeleton loaders, data fetching, AND forms. If tree-shaking works perfectly, maybe. But most bundlers would import the whole module. Being honest about "core is 2kB, with everything it is 8kB" would be more trustworthy.

---

## Questions I Would Ask on Discord/Stack Overflow

1. "I wrote `h('p', null, count)` but my counter never updates. What am I doing wrong?" (Answer: you need `() => count()` for reactive text.)

2. "Should I use `signal()` or `useState()`? The docs show both and I do not know which is recommended."

3. "How do I add CSS modules to my What project? The docs mention it is possible but do not show setup."

4. "My `useEffect` runs twice on mount. Is this a bug?" (Probably a React-18-style strict mode concern, but What may not have this.)

5. "How do I share state between two components that are not parent/child?" (Answer: `createStore` or `atom`, but neither is shown in the quickstart.)

6. "Can I use JSX with What? Writing `h()` is driving me crazy."

7. "I used `useSWR` but my data refetches every time I switch tabs. How do I control this?" (Answer: `revalidateOnFocus: false`, but the default is `true` and I might not know that option exists.)

8. "What is the difference between `show()` and the `Show` component? And between `each()` and `For`?"

9. "How do I do error handling in my data fetching? `useSWR` returns `error` but what do I do with it in the UI?"

10. "I want to animate a list of items entering and leaving. How do I use `spring` or `tween` for that?" (The animation examples only show single elements, not list transitions.)

11. "My form validation runs but the error messages do not appear. I wrote `formState.errors.email` instead of `formState.errors().email`. Why is there no TypeScript error for this?" (There should be, but only if the type definitions are correct.)

12. "How do I deploy this? The CLI has `what build` and `what generate` -- which one do I use? What is the difference between `build` and `generate`?"

---

## Would I Choose This Over React?

**Honest answer: Not today, but maybe in 6 months.**

**Why not today:**
- The `h()` function is a dealbreaker for building real UIs without JSX support.
- The packages are not published to npm, so I literally cannot use it.
- The documentation has too many contradictions (signal vs useState, import paths, inconsistent examples).
- The ecosystem is zero. No component libraries, no tutorials, no Stack Overflow answers, no community. If I get stuck, I have nowhere to go except reading source code.
- I would be the only person at my company using this. That is a career risk. If I leave, nobody can maintain my code.

**Why maybe in 6 months:**
- If JSX support is added (even via a simple Babel plugin), the authoring experience would be great.
- The signals-based reactivity is genuinely better than React's for avoiding stale closures and dependency array bugs.
- The bundle size is impressive and would matter for performance-sensitive projects.
- The built-in form, data fetching, and routing reduce dependency count significantly.
- If the docs are cleaned up and the packages are published, the getting-started experience would be quick.

**Under what circumstances would I choose this?**
- A new performance-critical project (marketing site, e-commerce) where bundle size matters.
- A team that is already frustrated with React's re-render performance and memoization ceremony.
- A project using islands architecture (like a content site with interactive widgets).
- If JSX is supported and the docs are clearer about the "recommended" way to build things.

I would NOT choose this for:
- A large team project (ecosystem and hiring concerns).
- An app that heavily uses third-party React component libraries.
- Anything where long-term maintenance by someone other than me is important.

---

## Suggestions for Better Onboarding

### 1. Pick ONE state management pattern for docs and stick with it.
The README and QUICKSTART should use `useState` exclusively (since juniors know it from React). Introduce `signal()` and `useSignal()` in an "Advanced" section. Do not show three ways to do the same thing on page one.

### 2. Explain the `() => value()` pattern upfront.
Add a dedicated section called "Reactive Expressions in Templates" that explains:
- Static: `h('p', null, 'Hello')` -- never changes.
- Reactive: `h('p', null, () => name())` -- updates when `name` changes.
- This is the most important concept and it is currently undiscovered by accident.

### 3. Add JSX support.
Even a simple Babel plugin that transforms `<div>` to `h('div', ...)` would make the framework 10x more adoptable. The `html` tagged template is a second option but it needs to be promoted in every example, not hidden in the API docs.

### 4. Standardize import paths.
Pick `'what'` and `'what/router'` and use them everywhere: README, QUICKSTART, demo, scaffolder. Remove all references to `@what/core` and `@aspect/core` from user-facing code.

### 5. Add a "React Migration" guide.
A page that shows React code on the left and What code on the right, for 10 common patterns. This would cut learning time in half.

### 6. Reduce the core API surface.
Move animation, a11y, skeleton, data fetching, and forms into opt-in subpath exports. The core should be small and focused. Developers can pull in what they need.

### 7. Add more error messages.
If someone passes a raw signal value where a reactive function is expected, warn them. If someone calls a hook outside a component, the error is clear (good). If someone forgets `()` on a signal read, there is no warning (bad).

### 8. Publish to npm.
This is obvious but critical. Until `npm install what` works, the framework does not exist for most developers.

### 9. Add a playground.
A web-based playground (like the Svelte REPL or SolidJS playground) where people can try the framework without installing anything. This is the fastest path to adoption.

### 10. Add a "Why not JSX?" section.
If the decision to not support JSX is intentional, explain why. "No compiler needed" is a good reason, but developers need to hear it explicitly and understand the tradeoff. The `html` template literal should be the prominently suggested alternative with examples everywhere.
