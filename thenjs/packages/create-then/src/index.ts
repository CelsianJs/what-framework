#!/usr/bin/env node
// create-then — Project scaffolder for ThenJS

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    template: { type: 'string', short: 't', default: 'starter' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(`
Usage: create-then [project-name] [options]

Options:
  -t, --template <name>   Template to use (starter, full-stack)
  -h, --help              Show help

Examples:
  npx create-then my-app
  npx create-then my-app --template full-stack
  `);
  process.exit(0);
}

const projectName = positionals[0] ?? 'my-then-app';
const template = values.template ?? 'starter';
const projectDir = resolve(process.cwd(), projectName);

console.log(`
  Creating ThenJS project: ${projectName}
  Template: ${template}
  Directory: ${projectDir}
`);

await scaffold(projectDir, projectName, template);

console.log(`
  Done! To get started:

    cd ${projectName}
    npm install
    npx thenjs dev

  Happy building!
`);

// ─── Templates ───

async function scaffold(dir: string, name: string, template: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'src', 'pages'), { recursive: true });
  await mkdir(join(dir, 'src', 'api'), { recursive: true });

  // package.json
  await writeFile(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'thenjs dev',
      build: 'thenjs build',
      preview: 'thenjs preview',
    },
    dependencies: {
      'thenjs': '^0.1.0',
      'what-framework': '^0.4.0',
    },
    devDependencies: {
      'typescript': '^5.7.0',
      'vite': '^6.0.0',
    },
  }, null, 2));

  // tsconfig.json
  await writeFile(join(dir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'preserve',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
    },
    include: ['src'],
  }, null, 2));

  // then.config.ts
  await writeFile(join(dir, 'then.config.ts'), `import { defineConfig } from 'thenjs';

export default defineConfig({
  server: {
    defaultPageMode: 'hybrid',
  },
  build: {
    adapter: 'auto',
  },
});
`);

  // Home page
  await writeFile(join(dir, 'src', 'pages', 'index.tsx'), `export const page = { mode: 'hybrid' };

export default function Home() {
  return (
    <main>
      <h1>Welcome to ThenJS</h1>
      <p>The meta-framework for What Framework.</p>
    </main>
  );
}
`);

  // Layout
  await writeFile(join(dir, 'src', 'pages', '_layout.tsx'), `export default function Layout({ children }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>ThenJS App</title>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
`);

  // API route
  await writeFile(join(dir, 'src', 'api', 'health.ts'), `export function GET() {
  return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
}
`);

  // Entry files
  await writeFile(join(dir, 'src', 'entry-client.tsx'), `import { mount } from 'what-framework';
import App from './pages/index.tsx';

mount(App, document.getElementById('app')!);
`);

  await writeFile(join(dir, 'src', 'entry-server.tsx'), `import { renderToString } from 'what-framework/server';

export async function render(url: string) {
  // Dynamic import based on route
  const Page = (await import('./pages/index.tsx')).default;
  const Layout = (await import('./pages/_layout.tsx')).default;

  const content = renderToString(Page);

  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ThenJS App</title>
</head>
<body>
  <div id="app">\${content}</div>
  <script type="module" src="/src/entry-client.tsx"></script>
</body>
</html>\`;
}
`);

  if (template === 'full-stack') {
    await scaffoldFullStack(dir);
  }
}

async function scaffoldFullStack(dir: string): Promise<void> {
  await mkdir(join(dir, 'src', 'rpc'), { recursive: true });
  await mkdir(join(dir, 'src', 'middleware'), { recursive: true });

  // RPC router
  await writeFile(join(dir, 'src', 'rpc', 'user.ts'), `import { procedure, router } from '@thenjs/rpc';
import { z } from 'zod';

export const userRouter = router({
  getById: procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return { id: input.id, name: 'John Doe', email: 'john@example.com' };
    }),

  create: procedure
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .mutation(async ({ input }) => {
      return { id: crypto.randomUUID(), ...input };
    }),
});
`);

  // RPC index
  await writeFile(join(dir, 'src', 'rpc', 'index.ts'), `import { userRouter } from './user.js';

export default {
  user: userRouter,
};
`);

  // Auth middleware
  await writeFile(join(dir, 'src', 'middleware', 'auth.ts'), `import type { HookHandler } from '@thenjs/server';

export const authHook: HookHandler = async (request, reply) => {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) {
    return reply.status(401).json({ error: 'Unauthorized' });
  }
  // Validate token and attach user to request
  (request as any).user = { id: '1', role: 'user' };
};
`);

  // Update then.config.ts for full-stack
  await writeFile(join(dir, 'then.config.ts'), `import { defineConfig } from 'thenjs';

export default defineConfig({
  server: {
    defaultPageMode: 'hybrid',
  },
  build: {
    adapter: 'auto',
  },
  rpc: {
    schema: 'zod',
    openapi: {
      title: 'My API',
      version: '1.0.0',
    },
  },
});
`);

  // Add zod dependency
  const pkgPath = join(dir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.dependencies['@thenjs/rpc'] = '^0.1.0';
  pkg.dependencies['zod'] = '^3.23.0';
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
}
