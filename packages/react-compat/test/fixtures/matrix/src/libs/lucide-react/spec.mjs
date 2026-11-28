export default {
  packages: ['lucide-react'],
  exercised: 'icons as `forwardRef` components rendering SVG: size, color, stroke width and class props as real SVG attributes, a ref to the `<svg>`, swapping one icon for another, a prop change on an icon, an icon picked by name from `icons`',
  async run(t) {
    await t.step('an icon renders SVG with its attributes', async () => {
      await t.eval(() => { const s = document.querySelector('#lu-camera'); return [s.namespaceURI.endsWith('/svg'), s.getAttribute('width'), s.getAttribute('height'), s.getAttribute('viewBox'), s.getAttribute('stroke'), s.getAttribute('stroke-width'), s.getAttribute('fill'), s.getAttribute('stroke-linecap')].join('|'); }, 'true|32|32|0 0 24 24|red|3|none|round');
      await t.eval(() => document.querySelector('#lu-camera').getAttribute('class').split(' ').sort().join(' '), 'extra lucide lucide-camera');
      await t.eval(() => document.querySelectorAll('#lu-camera > *').length > 1 && [...document.querySelectorAll('#lu-camera > *')].every((n) => n.namespaceURI.endsWith('/svg')), true, 'its shapes are SVG elements');
      await t.eval(() => document.querySelector('#lu-camera').getBoundingClientRect().width, 32);
      await t.attr('#lu-abs', 'stroke-width', '1');
    });
    await t.step('swapping one icon for another', async () => {
      await t.attr('#lu-icon', 'class', /lucide-menu/);
      await t.click('#lu-menu');
      await t.attr('#lu-icon', 'class', /lucide-x/);
      await t.click('#lu-menu');
      await t.attr('#lu-icon', 'class', /lucide-menu/);
      await t.count('#lu-menu svg', 1);
    });
    await t.step('a prop change updates the SVG attribute in place', async () => {
      await t.page.evaluate(() => { window.__heart = document.querySelector('#lu-heart'); });
      await t.click('#lu-like');
      await t.attr('#lu-heart', 'fill', 'red');
      await t.eval(() => window.__heart === document.querySelector('#lu-heart'), true);
    });
    await t.step('a ref reaches the svg element', async () => {
      await t.click('#lu-read');
      await t.text('#lu-tag', /^svg:.*lucide-loader/);
    });
    await t.step('an icon chosen by name', async () => {
      await t.attr('#lu-dynamic', 'class', /lucide-sun/);
      await t.click('#lu-swap');
      await t.attr('#lu-dynamic', 'class', /lucide-moon/);
    });
  },
};
