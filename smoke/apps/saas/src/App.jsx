// Northstar: a multi-tenant console. Every page is a file in src/pages, with
// a _layout per section (the app frame, an org's shell, its projects); the
// file router turns them into routes and FileRouter renders them, on the
// server for the first request and in the browser after that.

import { useLoaderData } from 'what-framework';
import { FileRouter } from 'what-router';
import { routes } from 'virtual:what-routes';
import { Session, createSession } from './session.js';

export default function App() {
  const session = createSession(useLoaderData()?.session);
  return (
    <Session.Provider value={session}>
      <FileRouter routes={routes} />
    </Session.Provider>
  );
}
