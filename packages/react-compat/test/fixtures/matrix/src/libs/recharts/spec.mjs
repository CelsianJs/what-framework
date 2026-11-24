export default {
  packages: ['recharts'],
  exercised: 'BarChart (two series, grid, axes, legend), a hover Tooltip, a click on a bar, new data reconciled into the same SVG; a LineChart sized by `ResponsiveContainer`; a PieChart with `Cell` children',
  async run(t) {
    await t.step('the bar chart draws real geometry with SVG attributes', async () => {
      await t.count('.recharts-bar-rectangle', 6);
      await t.eval(() => Number(document.querySelector('.recharts-bar-rectangle path, .recharts-bar-rectangle rect').getBoundingClientRect().height) > 10, true, 'a bar has height');
      await t.eval(() => document.querySelector('.recharts-cartesian-grid line')?.getAttribute('stroke-dasharray'), '3 3');
      await t.eval(() => [...document.querySelectorAll('.recharts-legend-item')].map((l) => l.textContent).sort().join(','), 'cost,sales');
      await t.eval(() => [...document.querySelector('.recharts-xAxis-tick-labels').querySelectorAll('.recharts-cartesian-axis-tick-value')].slice(0, 3).map((x) => x.textContent).join(','), 'Mon,Tue,Wed');
      await t.page.evaluate(() => { window.__svg = document.querySelector('.recharts-surface'); });
    });
    await t.step('hovering a bar shows the tooltip', async () => {
      await t.page.locator('.recharts-bar-rectangle').nth(1).hover();
      await t.until(() => t.page.evaluate(() => { const w = document.querySelector('.recharts-tooltip-wrapper'); return w && getComputedStyle(w).visibility === 'visible' ? w.textContent : null; }), (v) => typeof v === 'string' && v.includes('Tue') && v.includes('45'), 'the tooltip names Tue and its value');
    });
    await t.step('a click on a bar', async () => {
      await t.page.locator('.recharts-bar-rectangle').nth(2).click();
      await t.text('#rc-picked', 'Wed');
    });
    await t.step('new data adds bars to the same SVG', async () => {
      await t.click('#rc-add');
      await t.count('.recharts-bar-rectangle', 8);
      await t.eval(() => window.__svg === document.querySelector('.recharts-surface'), true, 'the chart was not rebuilt');
    });
    await t.step('ResponsiveContainer sizes the line chart from its parent', async () => {
      await t.eval(() => { const s = document.querySelector('#rc-responsive .recharts-surface'); return s ? `${s.getAttribute('width')}x${s.getAttribute('height')}` : null; }, '400x200');
      await t.eval(() => { const p = document.querySelector('#rc-responsive .recharts-line-curve'); return p && p.getAttribute('d').length > 20 && p.getAttribute('stroke-width'); }, '3');
    });
    await t.step('the pie draws a sector per Cell with its fill', async () => {
      await t.count('.recharts-pie-sector', 4);
      await t.eval(() => document.querySelector('.recharts-pie-sector path')?.getAttribute('fill'), '#0088fe');
    });
  },
};
