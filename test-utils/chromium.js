// Whether the browser tests can run here: whether Chromium launches, which is
// what they do. A headless launch runs Playwright's headless shell, not the
// full browser `chromium.executablePath()` names, so checking that file
// skipped the tests where only the shell is installed and failed them where
// only the full browser is. WHAT_REQUIRE_BROWSER_TESTS=1 turns "cannot launch"
// into a failure that says why.

/** @param {import('playwright').BrowserType} chromium */
export async function chromiumLaunches(chromium) {
  try {
    const browser = await chromium.launch();
    await browser.close();
    return true;
  } catch (error) {
    if (process.env.WHAT_REQUIRE_BROWSER_TESTS === '1') {
      throw new Error(`WHAT_REQUIRE_BROWSER_TESTS=1 but Chromium does not launch (${String(error && error.message).split('\n')[0]}); run npx playwright install --with-deps chromium.`, { cause: error });
    }
    return false;
  }
}
