export default {
  packages: ['framer-motion'],
  exercised: '`motion.div` mount and prop-driven animation with `onAnimationComplete`, `AnimatePresence` exit before unmount and re-entry, variants propagating to staggered children, `whileHover`, pointer `drag` writing a motion value that a `useTransform` child renders without re-rendering',
  async run(t) {
    await t.step('the mount animation runs to its end', async () => {
      await t.style('#fm-box', 'opacity', '1');
      await t.text('#fm-done', '1');
    });
    await t.step('a prop change animates the transform', async () => {
      await t.click('#fm-move');
      await t.until(() => t.page.evaluate(() => document.querySelector('#fm-box').style.transform), (v) => v === 'translateX(120px)', 'the box ends at translateX(120px)');
      await t.text('#fm-done', '2');
    });
    await t.step('AnimatePresence keeps the element for its exit, then removes it', async () => {
      await t.style('#fm-note', 'opacity', '1');
      await t.page.evaluate(() => {
        window.__exit = [];
        const el = document.querySelector('#fm-note');
        const tick = () => { if (el.isConnected) { window.__exit.push(Number(getComputedStyle(el).opacity)); requestAnimationFrame(tick); } };
        document.querySelector('#fm-toggle').addEventListener('click', () => requestAnimationFrame(tick), { once: true });
      });
      await t.click('#fm-toggle');
      await t.gone('#fm-note');
      await t.eval(() => window.__exit.length >= 2 && window.__exit.some((o) => o < 1), true, 'the element stayed mounted while its opacity fell');
      await t.click('#fm-toggle');
      await t.style('#fm-note', 'opacity', '1');
    });
    await t.step('variants reach the children', async () => {
      await t.eval(() => [...document.querySelectorAll('.fm-item')].map((li) => getComputedStyle(li).opacity).join(','), '0,0,0');
      await t.click('#fm-open');
      await t.until(() => t.page.evaluate(() => [...document.querySelectorAll('.fm-item')].map((li) => getComputedStyle(li).opacity + '|' + li.style.transform).join(',')), (v) => v === '1|none,1|none,1|none', 'every item is visible and in place');
    });
    await t.step('whileHover', async () => {
      await t.hover('#fm-hover');
      await t.until(() => t.page.evaluate(() => document.querySelector('#fm-hover').style.transform), (v) => v === 'scale(1.5)', 'the button scales on hover');
      await t.page.mouse.move(5, 700);
      await t.until(() => t.page.evaluate(() => document.querySelector('#fm-hover').style.transform), (v) => v === 'none' || v === '', 'the scale is released');
    });
    await t.step('a pointer drag moves the element and its motion value', async () => {
      const box = await t.page.locator('#fm-drag').boundingBox();
      await t.page.mouse.move(box.x + 30, box.y + 20);
      await t.page.mouse.down();
      for (let i = 1; i <= 8; i++) { await t.page.mouse.move(box.x + 30 + i * 10, box.y + 20); await t.sleep(16); }
      await t.page.mouse.up();
      await t.until(() => t.page.evaluate(() => Math.round(document.querySelector('#fm-drag').getBoundingClientRect().x)), (x) => Math.abs(x - Math.round(box.x + 80)) <= 4, `the element moved about 80px from ${Math.round(box.x)}`);
      await t.until(() => t.page.evaluate(() => Number(document.querySelector('#fm-x').textContent)), (v) => v >= 74 && v <= 84, 'the transformed motion value rendered');
    });
  },
};
