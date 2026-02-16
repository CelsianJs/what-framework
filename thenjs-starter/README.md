# ThenJS Starter

A minimal starter template for [ThenJS](https://github.com/zvndev/thenjs) — the full-stack meta-framework for the What Framework.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/zvndev/thenjs-starter)

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/zvndev/thenjs-starter)

## Getting Started

```bash
# Clone and install
npx degit zvndev/thenjs-starter my-app
cd my-app
npm install

# Start dev server
npm run dev
```

## Project Structure

```
src/
  pages/
    _layout.tsx    # Root layout
    index.tsx      # Home page (hybrid)
    about.tsx      # About page (static)
  api/
    health.ts      # Health check endpoint
then.config.ts     # ThenJS configuration
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build |

## Learn More

- [ThenJS Documentation](https://thenjs.dev)
- [GitHub Repository](https://github.com/zvndev/thenjs)

## License

MIT
