const click = (name, selector, expected, max) => ({ action: 'click', name, selector, expected, max });
const fill = (target, value, selector, expected, max) => ({ action: 'fill', target, value, selector, expected, max });

export const flows = {
  dashboard: [click('Charts', 'button.active', /^Charts$/, 70)],
  'dx-testbed': [{ ...click('+', '.section', /Doubled:\s*2/, 6), syncBudget: true }],
  kanban: [{ action: 'link', target: '.board-card[href]', selector: '.board__header', expected: /./, max: 90 }],
  todomvc: [
    { action: 'enter', target: '.new-todo', value: 'Smoke task', selector: '.todo-list li', expected: /Smoke task/, max: 28 },
  ],
  'what-starter': [{ action: 'link', target: 'a[href="/add"]', selector: 'form', expected: /Add Contact/, max: 80 }],
  'npm-app-suite/app-01-signals': [click('+', 'output', /^1$/, 8)],
  'npm-app-suite/app-02-computed': [click('+1', '.totals', /Total: \$518\.40/, 10)],
  'npm-app-suite/app-03-store': [{ action: 'enter', target: 'input[placeholder="Add a todo"]', value: 'Smoke task', selector: 'li', expected: /Smoke task/, max: 18 }],
  'npm-app-suite/app-04-forms': [fill('input[type=email]', 'invalid', 'main', /Email is invalid/i, 16)],
  'npm-app-suite/app-05-focus': [
    click('Open Modal', '[role=dialog]', /Keyboard Test/, 15),
    { ...click('Close', '[role=dialog]', /Keyboard Test/, 8), disappears: true },
  ],
  'npm-app-suite/app-06-html': [click('Increment', '.panel', /Rendered count:\s*2/, 6)],
  'npm-app-suite/app-07-events-style': [click('onClick: 0', 'button', /onClick:\s*1/, 5)],
  'npm-app-suite/app-08-data': [click('Optimistic +1 user', 'pre', /optimistic/, 12)],
  'real-world-suite/app-01-simple-counter-todo': [{ action: 'click', target: '[data-testid=increment-btn]', selector: '[data-testid=counter-value]', expected: /^1$/, max: 6 }],
  'real-world-suite/app-02-api-cache-dashboard': [click('Simulate Errors', '[data-testid=error-btn]', /Errors ON/, 28)],
  'real-world-suite/app-03-global-state': [
    { action: 'enter', target: '[data-testid=task-input]', value: 'Smoke task', selector: '[data-testid^=task-item-]', expected: /Smoke task/, max: 28 },
  ],
  'real-world-suite/app-04-virtual-table': [fill('[data-testid=search-input]', 'no matching row', '[data-testid=row-count]', /0 of 0/, 48)],
  'real-world-suite/app-05-react-compat': [{ action: 'click', target: '[data-testid=cart-toggle]', selector: '[data-testid=cart-sidebar]', expected: /Your Cart/ }],
  'scaffold-spa': [click('+', 'output', /^1$/)],
  'scaffold-islands': [click('Increase', '.counter output', /^4$/)],
  'scaffold-fullstack': [click('Like', '.like-demo output', /^1$/)],
  // sites/showcase, served by its serve.js from the workspace source.
  showcase: [
    click('Month', '.chart-tab.active', /^Month$/),
    { action: 'link', name: /Projects/, selector: '.main-header h1', expected: /^Projects$/ },
    click('Bug', 'button.btn-primary', /^Bug$/),
    { action: 'link', name: /Team/, selector: '.team-grid', expected: /Online/ },
    { action: 'link', name: /Settings/, selector: '.settings-nav-item.active', expected: /^Profile$/ },
    click('Toggle theme', '.toast', /Switched to light theme/),
  ],
  'package-demos/02-what-router': [{ action: 'link', name: 'About', selector: 'h2', expected: /^About$/ }],
  'blog': [{ action: 'link', name: /New Post/i, selector: 'h1', expected: /New post/i }],
  // "Add to cart" is a plain form post from a cached product page (no token
  // in its shared HTML): the browser's own headers carry it past the CSRF check.
  'shop': [
    { action: 'link', name: /No-VDOM Tee/, selector: 'h1', expected: /No-VDOM Tee/ },
    { action: 'button', name: 'Add to cart', selector: 'h1', expected: /Your cart/ },
    { action: 'link', name: /Keep shopping/, selector: 'h1', expected: /What Shop/ },
    { action: 'link', name: /Dashboard/i, selector: 'main', expected: /Not authorized/i },
  ],
};

export async function drive(page, { action, name, target, value, selector, expected, max, disappears = false, syncBudget = false }, budgets = false) {
  const control = target ? page.locator(target).first() : page.getByRole(action === 'link' ? 'link' : 'button', { name, exact: true }).first();
  if (budgets && max != null) {
    await page.waitForFunction(() => typeof window.beginInteractionCapture === 'function');
    if (!syncBudget) await page.evaluate(() => window.beginInteractionCapture());
  }
  if (budgets && syncBudget) {
    // This page has several unrelated polling demos. Budget the counter's
    // synchronous click and flush in one browser task.
    await control.evaluate(async (element, max) => {
      window.beginInteractionCapture();
      element.click();
      await window.endInteractionCapture(max);
    }, max);
  } else if (action === 'fill') await control.fill(value);
  else if (action === 'check') await control.check();
  else if (action === 'enter') { await control.fill(value); await control.press('Enter'); }
  else await control.click();
  await page.waitForFunction(({ selector, pattern, flags, disappears }) => [...document.querySelectorAll(selector)].some(el =>
    new RegExp(pattern, flags).test(el.textContent.trim())) !== disappears, { selector, pattern: expected.source, flags: expected.flags, disappears });
  if (budgets && max != null && !syncBudget) await page.evaluate(max => window.endInteractionCapture(max), max);
}
