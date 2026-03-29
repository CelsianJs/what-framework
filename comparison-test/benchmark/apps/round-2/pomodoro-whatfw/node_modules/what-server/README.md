# what-server

Server-side rendering, streaming, islands architecture, and static site generation for [What Framework](https://whatfw.com). Zero JavaScript shipped by default -- islands opt in to client interactivity.

## Install

```bash
npm install what-server what-core
```

Or use via the main package:

```js
import { renderToString, renderToStream } from 'what-framework/server';
```

## Render to String

```js
import { renderToString } from 'what-server';
import { h } from 'what-core';

function App() {
  return h('div', null,
    h('h1', null, 'Hello from the server'),
    h('p', null, 'This page ships zero JavaScript.')
  );
}

const html = renderToString(h(App));
// <div><h1>Hello from the server</h1><p>This page ships zero JavaScript.</p></div>
```

## Streaming SSR

```js
import { renderToStream } from 'what-server';

for await (const chunk of renderToStream(h(App))) {
  response.write(chunk);
}
response.end();
```

## Page Modes

```js
import { definePage } from 'what-server';

export const page = definePage({
  mode: 'static',  // Pre-render at build time (default)
  // mode: 'server'  // Render on each request
  // mode: 'client'  // Render in browser (SPA)
  // mode: 'hybrid'  // Static shell + interactive islands
});
```

## Static Generation

```js
import { generateStaticPage } from 'what-server';

const html = generateStaticPage({
  component: App,
  title: 'My Page',
  meta: { description: 'A statically generated page' },
  mode: 'static',
});
```

## Server Components

Mark components as server-only. They render on the server and ship no JavaScript to the client.

```js
import { server } from 'what-server';

const Header = server(({ title }) => h('header', null, title));
```

## Server Actions

```js
import { action, useAction, formAction, useFormAction } from 'what-server/actions';

// Define a server action
const addTodo = action(async (text) => {
  await db.todos.create({ text });
});

// Use in a component
function TodoForm() {
  const { execute, isPending } = useAction(addTodo);
  return h('button', { onclick: () => execute('New todo') }, 'Add');
}

// Form action
const submitForm = formAction(async (formData) => {
  const email = formData.get('email');
  await subscribe(email);
});
```

## Sub-path Exports

| Path | Contents |
|---|---|
| `what-server` | `renderToString`, `renderToStream`, `definePage`, `generateStaticPage`, `server` |
| `what-server/islands` | Islands hydration runtime |
| `what-server/actions` | Server actions and mutations |

## API

| Export | Description |
|---|---|
| `renderToString(vnode)` | Render a component tree to an HTML string |
| `renderToStream(vnode)` | Render as an async iterator for streaming |
| `definePage(config)` | Define page rendering mode and metadata |
| `generateStaticPage(page, data?)` | Generate a full HTML document |
| `server(Component)` | Mark a component as server-only |
| `action(fn)` | Define a server action |
| `formAction(fn)` | Define a form-based server action |
| `useAction(action)` | Hook to call a server action |
| `useFormAction(action)` | Hook for form server actions |
| `useOptimistic(state)` | Optimistic UI updates |
| `useMutation(fn)` | Mutation with loading/error states |
| `invalidatePath(path)` | Revalidate a page path |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
