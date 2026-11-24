const measure = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width);

export default {
  packages: ['react-resizable-panels'],
  exercised: 'two panels with a separator: the default layout measured into sizes, a pointer drag on the separator resizing both panels, arrow keys on the focused separator, `onLayoutChange`, state inside a panel kept',
  async run(t) {
    let start;
    await t.step('the default layout splits the group', async () => {
      await t.until(() => t.page.evaluate(measure, '#rp-left'), (w) => w > 270 && w < 320, 'the left panel is about half of 600px');
      start = await t.page.evaluate(measure, '#rp-left');
      await t.attr('#rp-handle', 'role', 'separator');
      await t.click('#rp-btn');
      await t.text('#rp-btn', 'left 1');
    });
    await t.step('dragging the separator resizes both panels', async () => {
      const box = await t.page.locator('#rp-handle').boundingBox();
      await t.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await t.page.mouse.down();
      for (let i = 1; i <= 10; i++) { await t.page.mouse.move(box.x + box.width / 2 + i * 10, box.y + box.height / 2); await t.sleep(16); }
      await t.page.mouse.up();
      await t.until(() => t.page.evaluate(measure, '#rp-left'), (w) => Math.abs(w - (start + 100)) <= 6, `the left panel grew by about 100px from ${start}`);
      await t.until(() => t.page.evaluate(measure, '#rp-right'), (w) => Math.abs(w - (600 - 8 - start - 100)) <= 6, 'the right panel shrank to match');
      await t.text('#rp-layout', /left/);
      await t.text('#rp-btn', 'left 1');
    });
    await t.step('arrow keys on the separator resize', async () => {
      const before = await t.page.evaluate(measure, '#rp-left');
      await t.page.focus('#rp-handle');
      await t.press('ArrowLeft');
      await t.press('ArrowLeft');
      await t.until(() => t.page.evaluate(measure, '#rp-left'), (w) => w < before - 5, `the left panel is narrower than ${before}`);
    });
  },
};
