export default {
  packages: ['@floating-ui/react'],
  exercised: '`useFloating` with offset, flip, shift, arrow and `autoUpdate`; `useClick`, `useDismiss`, `useRole`, `useHover`; `FloatingPortal`; `FloatingFocusManager` moving focus in and back; `useListNavigation` with arrow keys; the position measured from the reference',
  async run(t) {
    await t.step('a click opens the popover in a portal, 10px under its reference', async () => {
      await t.click('#fl-ref');
      await t.present('.fl-pop');
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('.fl-pop')), true, 'the popover is in a portal');
      await t.eval(() => { const p = document.querySelector('.fl-pop').getBoundingClientRect(); const r = document.querySelector('#fl-ref').getBoundingClientRect(); return `${Math.round(p.top - r.bottom)},${Math.round(p.left - r.left)}`; }, '10,0', 'offset from the reference (top, left)');
      await t.attr('#fl-ref', 'aria-expanded', 'true');
      await t.eval(() => document.querySelector('.fl-pop svg') !== null, true, 'the arrow rendered');
    });
    await t.step('focus moves into the popover and a controlled input works', async () => {
      await t.focus('fl-input');
      await t.type('#fl-input', 'hey');
      await t.text('#fl-text', 'hey');
      await t.focus('fl-input');
    });
    await t.step('Escape dismisses and returns focus', async () => {
      await t.press('Escape');
      await t.gone('.fl-pop');
      await t.focus('fl-ref');
    });
    await t.step('an outside press dismisses', async () => {
      await t.click('#fl-ref');
      await t.present('.fl-pop');
      await t.sleep(150);
      await t.page.mouse.click(800, 700);
      await t.gone('.fl-pop');
    });
    await t.step('hover opens the tooltip to the right of its reference', async () => {
      await t.hover('#fl-tip-ref');
      await t.attr('.fl-tip', 'role', 'tooltip');
      await t.eval(() => Math.round(document.querySelector('.fl-tip').getBoundingClientRect().left - document.querySelector('#fl-tip-ref').getBoundingClientRect().right), 6);
      await t.page.mouse.move(900, 700);
      await t.gone('.fl-tip');
    });
    await t.step('list navigation with arrow keys, and a pick', async () => {
      await t.click('.fl-menu-ref');
      await t.attr('.fl-menu', 'role', 'menu');
      await t.press('ArrowDown');
      await t.focus('Red');
      await t.press('ArrowDown');
      await t.focus('Green');
      await t.press('Enter');
      await t.text('#fl-picked', 'Green');
      await t.gone('.fl-menu');
    });
  },
};
