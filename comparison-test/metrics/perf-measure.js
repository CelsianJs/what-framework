/**
 * Performance measurement — uses Playwright to measure real app metrics.
 * Metrics: bundle size, time to interactive, render timing, DOM size.
 */

export class PerfMeasure {
  constructor(page) {
    this.page = page;
  }

  /**
   * Measure page load performance.
   */
  async measureLoad() {
    const metrics = await this.page.evaluate(() => {
      const perf = performance.getEntriesByType('navigation')[0];
      const paint = performance.getEntriesByType('paint');
      const fcp = paint.find(p => p.name === 'first-contentful-paint');

      return {
        domContentLoaded: Math.round(perf?.domContentLoadedEventEnd || 0),
        loadComplete: Math.round(perf?.loadEventEnd || 0),
        firstContentfulPaint: Math.round(fcp?.startTime || 0),
        domInteractive: Math.round(perf?.domInteractive || 0),
        transferSize: Math.round(perf?.transferSize || 0),
      };
    });

    return metrics;
  }

  /**
   * Measure DOM complexity.
   */
  async measureDOM() {
    return this.page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      let maxDepth = 0;

      function getDepth(el) {
        let depth = 0;
        let current = el;
        while (current.parentElement) {
          depth++;
          current = current.parentElement;
        }
        return depth;
      }

      for (const el of allElements) {
        maxDepth = Math.max(maxDepth, getDepth(el));
      }

      return {
        totalElements: allElements.length,
        maxDepth,
        bodyChildren: document.body.children.length,
      };
    });
  }

  /**
   * Measure network transfer.
   */
  async measureNetwork() {
    const resources = await this.page.evaluate(() => {
      const entries = performance.getEntriesByType('resource');
      let jsSize = 0;
      let cssSize = 0;
      let totalSize = 0;
      let jsCount = 0;
      let cssCount = 0;

      for (const entry of entries) {
        const size = entry.transferSize || 0;
        totalSize += size;

        if (entry.name.match(/\.js($|\?)/)) {
          jsSize += size;
          jsCount++;
        } else if (entry.name.match(/\.css($|\?)/)) {
          cssSize += size;
          cssCount++;
        }
      }

      return {
        totalTransferKB: Math.round(totalSize / 1024),
        jsBundleKB: Math.round(jsSize / 1024),
        cssBundleKB: Math.round(cssSize / 1024),
        jsFiles: jsCount,
        cssFiles: cssCount,
        totalRequests: entries.length,
      };
    });

    return resources;
  }

  /**
   * Measure interaction latency (click → DOM update).
   */
  async measureInteraction(selector, action = 'click') {
    const latency = await this.page.evaluate(async ({ selector, action }) => {
      const el = document.querySelector(selector);
      if (!el) return { error: 'Element not found' };

      const start = performance.now();

      // Create a mutation observer to detect the next DOM change
      return new Promise((resolve) => {
        const observer = new MutationObserver(() => {
          observer.disconnect();
          resolve({ latencyMs: Math.round((performance.now() - start) * 100) / 100 });
        });

        observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });

        // Trigger the action
        el[action]?.();
        el.dispatchEvent(new MouseEvent(action, { bubbles: true }));

        // Timeout after 5s
        setTimeout(() => {
          observer.disconnect();
          resolve({ latencyMs: -1, timeout: true });
        }, 5000);
      });
    }, { selector, action });

    return latency;
  }

  /**
   * Run all performance measurements.
   */
  async measureAll() {
    const load = await this.measureLoad();
    const dom = await this.measureDOM();
    const network = await this.measureNetwork();

    return {
      load,
      dom,
      network,
      timestamp: new Date().toISOString(),
    };
  }
}
