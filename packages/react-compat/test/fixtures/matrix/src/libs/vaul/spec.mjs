export default {
  packages: ['vaul'],
  exercised: 'a controlled `Drawer` (Radix dialog underneath): opens in a portal with its open state attributes, a controlled input inside, Close and Escape with the exit animation then unmount, and a pointer drag down that dismisses it',
  async run(t) {
    await t.step('the drawer opens in a portal', async () => {
      await t.click('#va-open');
      await t.attr('#va-content', 'role', 'dialog');
      await t.attr('#va-content', 'data-state', 'open');
      await t.present('#va-content[data-vaul-drawer]');
      await t.text('#va-state', 'open');
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('#va-content')), true, 'the drawer is in a portal');
    });
    await t.step('a controlled input inside', async () => {
      await t.sleep(600); // the enter animation
      await t.click('#va-input');
      await t.type('#va-input', 'milk');
      await t.text('#va-note', 'milk');
      await t.focus('va-input');
    });
    await t.step('Close animates out and unmounts', async () => {
      await t.click('#va-close');
      await t.text('#va-state', 'closed');
      await t.gone('#va-content');
      await t.gone('#va-overlay');
    });
    await t.step('Escape closes', async () => {
      await t.click('#va-open');
      await t.present('#va-content');
      await t.sleep(600);
      await t.press('Escape');
      await t.gone('#va-content');
      await t.focus('va-open');
    });
    await t.step('dragging the drawer down dismisses it', async () => {
      await t.click('#va-open');
      await t.present('#va-content');
      await t.sleep(700);
      const box = await t.page.locator('#va-content').boundingBox();
      const x = box.x + box.width / 2;
      await t.page.mouse.move(x, box.y + 12);
      await t.page.mouse.down();
      for (let i = 1; i <= 12; i++) { await t.page.mouse.move(x, box.y + 12 + i * 22); await t.sleep(16); }
      await t.eval(() => /translate3d\(0px, \d/.test(document.querySelector('#va-content')?.style.transform ?? ''), true, 'the drawer follows the pointer');
      await t.page.mouse.up();
      await t.text('#va-state', 'closed');
      await t.gone('#va-content');
    });
  },
};
