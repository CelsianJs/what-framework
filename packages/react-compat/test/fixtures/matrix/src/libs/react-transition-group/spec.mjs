export default {
  packages: ['react-transition-group'],
  exercised: 'class components with lifecycles: `CSSTransition` enter and exit classes in order with callbacks and `unmountOnExit`, `TransitionGroup` cloning keyed children (add, and removal held until the exit ends), `SwitchTransition` out-in',
  async run(t) {
    await t.step('enter: mounts, runs the classes, calls back in order', async () => {
      await t.gone('#tg-box');
      await t.click('#tg-toggle');
      await t.attr('#tg-box', 'class', 'fade-enter-done');
      await t.text('#tg-log', 'enter,entered');
    });
    await t.step('exit: runs the classes, then unmounts', async () => {
      await t.page.evaluate(() => {
        window.__classes = [];
        const el = document.querySelector('#tg-box');
        new MutationObserver(() => window.__classes.push(el.className)).observe(el, { attributes: true, attributeFilter: ['class'] });
      });
      await t.click('#tg-toggle');
      await t.gone('#tg-box');
      await t.text('#tg-log', 'enter,entered,exit,exited');
      await t.eval(() => window.__classes.some((c) => c.includes('fade-exit-active')), true, 'the exit-active class was applied before the unmount');
    });
    await t.step('TransitionGroup adds an item with its enter classes', async () => {
      await t.count('.tg-item', 2);
      await t.click('#tg-add');
      await t.count('.tg-item', 3);
      await t.until(() => t.page.evaluate(() => document.querySelectorAll('.tg-item')[2].className), (c) => c.includes('fade-enter-done'), 'the new item finished entering');
    });
    await t.step('a removed item stays for its exit, then leaves', async () => {
      await t.page.evaluate(() => {
        window.__kept = false;
        const first = document.querySelectorAll('.tg-item')[0];
        new MutationObserver(() => { if (first.isConnected && first.className.includes('fade-exit')) window.__kept = true; }).observe(first, { attributes: true });
      });
      await t.page.locator('.tg-remove').first().click();
      await t.count('.tg-item', 2);
      await t.eval(() => window.__kept, true, 'the item was still mounted with its exit class');
      await t.eval(() => [...document.querySelectorAll('.tg-item')].map((li) => li.textContent.trim().replace(' x', '')).join(','), 'item 2,item 3');
    });
    await t.step('SwitchTransition swaps out-in', async () => {
      await t.text('#tg-mode', 'mode a');
      await t.click('#tg-switch');
      await t.text('#tg-mode', 'mode b');
      await t.count('#tg-mode', 1);
      await t.attr('#tg-mode', 'class', 'fade-enter-done');
    });
  },
};
