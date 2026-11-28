const domOrder = () => [...document.querySelectorAll('.dk-item')].map((el) => el.textContent).join('');

export default {
  packages: ['@dnd-kit/core', '@dnd-kit/sortable'],
  exercised: 'a sortable list: a pointer drag (the other items shift with transforms, a `DragOverlay` follows, the drop reorders), a keyboard drag (Space, arrows, Space) with the screen-reader announcement, keyed DOM nodes kept across the reorder',
  async run(t) {
    await t.step('first render with drag attributes', async () => {
      await t.text('#dk-order', 'ABCD');
      await t.attr('#dk-A', 'role', 'button');
      await t.attr('#dk-A', 'aria-roledescription', 'sortable');
      await t.page.evaluate(() => { window.__nodeD = document.querySelector('#dk-D'); });
    });
    await t.step('a pointer drag moves D above B', async () => {
      const from = await t.page.locator('#dk-D').boundingBox();
      const to = await t.page.locator('#dk-B').boundingBox();
      const x = from.x + from.width / 2;
      await t.page.mouse.move(x, from.y + from.height / 2);
      await t.page.mouse.down();
      for (let i = 1; i <= 10; i++) { await t.page.mouse.move(x, from.y + from.height / 2 + ((to.y + to.height / 2 - (from.y + from.height / 2)) * i) / 10); await t.sleep(20); }
      await t.text('#dk-active', 'D');
      await t.text('#dk-overlay', 'dragging D');
      await t.eval(() => document.querySelector('#dk-B').style.transform !== '', true, 'the items it passes shift with a transform');
      await t.page.mouse.up();
      await t.text('#dk-order', 'ADBC');
      await t.text('#dk-active', 'none');
      await t.gone('#dk-overlay');
      await t.eval(domOrder, 'ADBC');
      await t.eval(() => window.__nodeD === document.querySelector('#dk-D'), true, 'the dragged element is the same DOM node');
    });
    await t.step('a keyboard drag moves A down two places', async () => {
      // The drop's shift transitions have to end first: the keyboard sensor measures the items.
      await t.eval(() => [...document.querySelectorAll('.dk-item')].every((el) => el.style.transform === '' && el.getAnimations().length === 0), true, 'the items are at rest');
      await t.page.mouse.move(700, 600);
      await t.sleep(300);
      await t.page.focus('#dk-A');
      await t.press('Space');
      await t.text('#dk-active', 'A');
      await t.eval(() => [...document.querySelectorAll('[aria-live]')].some((el) => /raggable item A/.test(el.textContent)), true, 'the drag is announced in the live region');
      // dnd-kit starts listening for arrow keys a timer tick after the pick-up.
      await t.sleep(200);
      // Each move is announced once it has landed; the next key waits for it.
      const announced = (area) => t.eval((name) => [...document.querySelectorAll('[aria-live]')].some((el) => el.textContent.includes(`moved over droppable area ${name}`)), true, `the move over ${area} is announced`, area);
      await t.press('ArrowDown');
      await announced('D');
      await t.sleep(250); // the items' shift transition
      await t.press('ArrowDown');
      await announced('B');
      await t.sleep(250);
      await t.press('Space');
      await t.text('#dk-order', 'DBAC');
      await t.eval(domOrder, 'DBAC');
      await t.text('#dk-drops', '2');
      await t.focus('dk-A');
    });
  },
};
