// Every URL no page answers: a 404, on the server too.

import { getResponse } from 'what-framework';
import { Link } from 'what-router';
import { loadPage } from '../loaders.js';

export const loader = (ctx) => loadPage(ctx);

export default function NotFound({ params }) {
  getResponse()?.setStatus(404);
  return (
    <main class="not-found" data-page="404">
      <h1>Nothing at /{params.rest}</h1>
      <p><Link href="/" data-home>Back to Northstar</Link></p>
    </main>
  );
}
