// What Framework E2E Tests — Critical Path Coverage
//
// Tests the core user-facing behaviors through a real browser:
// 1. Component rendering and reactivity
// 2. Signal updates propagating to DOM
// 3. Router navigation
// 4. Error boundary behavior
// 5. Computed values
// 6. Batch updates
// 7. List operations (add/remove)
// 8. URL sanitization

import { test, expect } from '@playwright/test';

// =========================================================================
// 1. Component Rendering
// =========================================================================

test.describe('Component Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders the home page with all sections', async ({ page }) => {
    await expect(page.getByTestId('home-page')).toBeVisible();
    await expect(page.getByTestId('counter')).toBeVisible();
    await expect(page.getByTestId('greeting')).toBeVisible();
    await expect(page.getByTestId('item-list')).toBeVisible();
    await expect(page.getByTestId('batch-updater')).toBeVisible();
    await expect(page.getByTestId('error-boundary-test')).toBeVisible();
  });

  test('renders initial signal values correctly', async ({ page }) => {
    await expect(page.getByTestId('count-display')).toHaveText('Count: 0');
    await expect(page.getByTestId('doubled-display')).toHaveText('Doubled: 0');
    await expect(page.getByTestId('greeting-text')).toHaveText('Hello, World!');
    await expect(page.getByTestId('item-count')).toHaveText('3 items');
  });
});

// =========================================================================
// 2. Signal Updates Propagating to DOM
// =========================================================================

test.describe('Signal Reactivity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('increment button updates count and computed doubled', async ({ page }) => {
    await page.getByTestId('increment-btn').click();
    await expect(page.getByTestId('count-display')).toHaveText('Count: 1');
    await expect(page.getByTestId('doubled-display')).toHaveText('Doubled: 2');

    await page.getByTestId('increment-btn').click();
    await expect(page.getByTestId('count-display')).toHaveText('Count: 2');
    await expect(page.getByTestId('doubled-display')).toHaveText('Doubled: 4');
  });

  test('decrement button updates count', async ({ page }) => {
    await page.getByTestId('increment-btn').click();
    await page.getByTestId('increment-btn').click();
    await page.getByTestId('decrement-btn').click();
    await expect(page.getByTestId('count-display')).toHaveText('Count: 1');
  });

  test('reset button sets count to zero', async ({ page }) => {
    await page.getByTestId('increment-btn').click();
    await page.getByTestId('increment-btn').click();
    await page.getByTestId('increment-btn').click();
    await expect(page.getByTestId('count-display')).toHaveText('Count: 3');

    await page.getByTestId('reset-btn').click();
    await expect(page.getByTestId('count-display')).toHaveText('Count: 0');
    await expect(page.getByTestId('doubled-display')).toHaveText('Doubled: 0');
  });

  test('typing in input updates greeting reactively', async ({ page }) => {
    const input = page.getByTestId('name-input');
    await input.fill('Kirby');
    await expect(page.getByTestId('greeting-text')).toHaveText('Hello, Kirby!');
  });
});

// =========================================================================
// 3. Router Navigation
// =========================================================================

test.describe('Router Navigation', () => {
  test('navigates to about page via link click', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();
    await expect(page).toHaveURL(/\/about$/);
  });

  test('navigates to user page with route params', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-user').click();
    await expect(page.getByTestId('user-page')).toBeVisible();
    await expect(page.getByTestId('user-id')).toHaveText('42');
    await expect(page).toHaveURL(/\/users\/42$/);
  });

  test('navigates back to home', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();

    await page.getByTestId('nav-home').click();
    await expect(page.getByTestId('home-page')).toBeVisible();
  });

  test('shows 404 for unknown routes', async ({ page }) => {
    await page.goto('/unknown-route');
    await expect(page.getByTestId('not-found-page')).toBeVisible();
  });

  test('preserves state across navigation', async ({ page }) => {
    await page.goto('/');
    // Increment counter
    await page.getByTestId('increment-btn').click();
    await page.getByTestId('increment-btn').click();
    await expect(page.getByTestId('count-display')).toHaveText('Count: 2');

    // Navigate away and back
    await page.getByTestId('nav-about').click();
    await expect(page.getByTestId('about-page')).toBeVisible();

    await page.getByTestId('nav-home').click();
    // Module-scope signals persist — count should still be 2
    await expect(page.getByTestId('count-display')).toHaveText('Count: 2');
  });
});

// =========================================================================
// 4. Error Boundary Behavior
// =========================================================================

test.describe('Error Boundary', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders children when no error occurs', async ({ page }) => {
    await expect(page.getByTestId('no-error')).toBeVisible();
    await expect(page.getByTestId('no-error')).toHaveText('No error yet');
  });

  test('catches initial render error and shows fallback', async ({ page }) => {
    // The broken component throws during initial render — ErrorBoundary should catch it
    await expect(page.getByTestId('error-fallback')).toBeVisible();
    await expect(page.getByTestId('error-message')).toContainText('Intentional render error');
  });
});

// =========================================================================
// 5. Batch Updates
// =========================================================================

test.describe('Batch Updates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('batch update sets both values atomically', async ({ page }) => {
    await expect(page.getByTestId('batch-sum')).toHaveText('Sum: 0');
    await page.getByTestId('batch-btn').click();
    await expect(page.getByTestId('batch-sum')).toHaveText('Sum: 30');
  });
});

// =========================================================================
// 6. List Operations
// =========================================================================

test.describe('List Operations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders initial items', async ({ page }) => {
    const listItems = page.getByTestId('items-ul').locator('li');
    await expect(listItems).toHaveCount(3);
    await expect(page.getByTestId('item-count')).toHaveText('3 items');
  });

  test('adds a new item', async ({ page }) => {
    // Directly manipulate the items signal to add a new item,
    // testing the reactive list update without input binding complexity.
    await page.evaluate(() => {
      const items = window.__TEST_SIGNALS__.items;
      items(prev => [...prev, { id: Date.now(), text: 'New item' }]);
    });
    await expect(page.getByTestId('item-count')).toHaveText('4 items');
    const listItems = page.getByTestId('items-ul').locator('li');
    await expect(listItems).toHaveCount(4);
  });

  test('removes an item', async ({ page }) => {
    await page.getByTestId('remove-1').click();
    await expect(page.getByTestId('item-count')).toHaveText('2 items');
    const listItems = page.getByTestId('items-ul').locator('li');
    await expect(listItems).toHaveCount(2);
  });
});

// =========================================================================
// 7. URL Sanitization (javascript: URL blocking)
// =========================================================================

test.describe('URL Sanitization', () => {
  test('isSafeUrl blocks javascript: URLs', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const isSafeUrl = window.__TEST_IS_SAFE_URL__;
      return {
        jsProtocol: isSafeUrl('javascript:alert(1)'),
        jsUpperCase: isSafeUrl('JAVASCRIPT:alert(1)'),
        jsMixed: isSafeUrl('JaVaScRiPt:alert(1)'),
        jsWithSpaces: isSafeUrl('  javascript:alert(1)  '),
        dataProtocol: isSafeUrl('data:text/html,<h1>hi</h1>'),
        vbscriptProtocol: isSafeUrl('vbscript:alert(1)'),
        normalUrl: isSafeUrl('/about'),
        httpUrl: isSafeUrl('https://example.com'),
        hashUrl: isSafeUrl('#section'),
      };
    });
    expect(result.jsProtocol).toBe(false);
    expect(result.jsUpperCase).toBe(false);
    expect(result.jsMixed).toBe(false);
    expect(result.jsWithSpaces).toBe(false);
    expect(result.dataProtocol).toBe(false);
    expect(result.vbscriptProtocol).toBe(false);
    expect(result.normalUrl).toBe(true);
    expect(result.httpUrl).toBe(true);
    expect(result.hashUrl).toBe(true);
  });

  test('navigate() blocks javascript: URLs', async ({ page }) => {
    await page.goto('/');
    // Try to navigate to a javascript: URL — should be blocked
    const beforeUrl = page.url();
    await page.evaluate(() => {
      window.__TEST_NAVIGATE__('javascript:alert(1)');
    });
    // URL should not have changed
    expect(page.url()).toBe(beforeUrl);
  });

  test('Link component sanitizes href', async ({ page }) => {
    await page.goto('/');
    // Verify that all nav links have safe hrefs
    const links = page.locator('nav a');
    const hrefs = await links.evaluateAll(els => els.map(el => el.getAttribute('href')));
    for (const href of hrefs) {
      expect(href).not.toMatch(/^javascript:/i);
      expect(href).not.toMatch(/^data:/i);
      expect(href).not.toMatch(/^vbscript:/i);
    }
  });
});

// =========================================================================
// 8. Programmatic Signal Access
// =========================================================================

test.describe('Signal Access from Browser', () => {
  test('signals are readable from window.__TEST_SIGNALS__', async ({ page }) => {
    await page.goto('/');
    const values = await page.evaluate(() => {
      const signals = window.__TEST_SIGNALS__;
      return {
        count: signals.count(),
        name: signals.name(),
        itemCount: signals.itemCount(),
        doubled: signals.doubled(),
      };
    });
    expect(values.count).toBe(0);
    expect(values.name).toBe('World');
    expect(values.itemCount).toBe(3);
    expect(values.doubled).toBe(0);
  });

  test('programmatic signal write updates DOM', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      window.__TEST_SIGNALS__.count(42);
    });
    await expect(page.getByTestId('count-display')).toHaveText('Count: 42');
    await expect(page.getByTestId('doubled-display')).toHaveText('Doubled: 84');
  });
});
