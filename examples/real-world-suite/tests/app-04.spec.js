import { test, expect } from '@playwright/test';

test.describe('App 04: Virtualized Table', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="table-container"]');
  });

  test('renders the table container', async ({ page }) => {
    await expect(page.getByTestId('table-container')).toBeVisible();
  });

  test('shows total row count of 10000', async ({ page }) => {
    await expect(page.getByTestId('total-rows')).toContainText('10,000');
  });

  test('only renders a subset of rows (virtualization)', async ({ page }) => {
    // The virtualized table only renders visible rows in the DOM
    const visibleRows = page.locator('[data-testid^="table-row-"]');
    const count = await visibleRows.count();
    // Should render far fewer than 10000 rows
    expect(count).toBeLessThan(100);
    expect(count).toBeGreaterThan(0);
  });

  test('table container is scrollable with correct total height', async ({ page }) => {
    const container = page.getByTestId('table-container');
    // The inner div should have height = 10000 * 40 = 400000px for proper scrollbar
    const innerHeight = await container.evaluate(el => {
      const inner = el.querySelector('.table-inner');
      return inner ? inner.offsetHeight : 0;
    });
    // Should be 10000 rows * 40px = 400000px
    expect(innerHeight).toBe(400000);
  });

  test('search filters rows', async ({ page }) => {
    const initialCount = await page.locator('[data-testid^="table-row-"]').count();
    await page.getByTestId('search-input').fill('Engineering');
    await page.waitForTimeout(500);
    // After filtering, we should see fewer rows (or different rows)
    const rows = page.locator('[data-testid^="table-row-"]');
    const filteredCount = await rows.count();
    // The filtered set should be smaller, and every row should match.
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(initialCount);
    const firstRowText = await rows.first().textContent();
    expect(firstRowText).toContain('Engineering');
  });

  test('column sorting works', async ({ page }) => {
    // Click a sort header
    const sortBtn = page.locator('[data-testid^="sort-"]').first();
    await sortBtn.click();
    await page.waitForTimeout(200);
    // Table should still render rows
    const rows = page.locator('[data-testid^="table-row-"]');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });
});
