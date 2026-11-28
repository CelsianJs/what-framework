export default {
  packages: ['@radix-ui/react-dialog', '@radix-ui/react-popover', '@radix-ui/react-tooltip', '@radix-ui/react-slot'],
  exercised: 'Dialog: `asChild` trigger on a `forwardRef` component, portal to `<body>`, focus moved in and trapped, a controlled input inside, a Popover nested in the dialog (its portal counts as inside), Escape closes the top layer only, focus returned to the trigger. Popover: positioned by Floating UI, closes on an outside press. Tooltip: opens on hover. `Slot` merges props onto its child, the class names of both joined. The page\'s scroll is locked while the dialog is open (react-remove-scroll, whose `enabled` comes from a function component\'s `defaultProps`)',
  async run(t) {
    await t.step('asChild puts the trigger props on the custom button', async () => {
      await t.attr('#rd-open', 'aria-haspopup', 'dialog');
      await t.attr('#rd-open', 'data-state', 'closed');
      await t.attr('#rd-open', 'class', 'fancy');
      await t.eval(() => document.querySelector('#rs-slot').tagName + ':' + document.querySelector('#rs-slot').dataset.slotted, 'SPAN:yes');
      // Slot joins its own className with the child's, which it reads from child.props.className.
      await t.attr('#rs-slot', 'class', 'from-slot from-child');
    });
    await t.step('the dialog opens in a portal and takes focus', async () => {
      await t.click('#rd-open');
      await t.attr('#rd-content', 'role', 'dialog');
      await t.attr('#rd-content', 'data-state', 'open');
      await t.eval(() => document.querySelector('#rd-content').parentElement === document.body, true, 'the dialog content is a child of <body>');
      await t.eval(() => document.querySelector('#rd-content').contains(document.activeElement), true, 'focus is inside the dialog');
      await t.eval(() => { const c = document.querySelector('#rd-content'); return c.getAttribute('aria-labelledby') === c.querySelector('h2').id; }, true, 'aria-labelledby names the title');
      await t.text('#rd-state', 'open');
      // Radix renders <RemoveScroll> without `enabled`: it is on through the component's defaultProps.
      await t.attr('body', 'data-scroll-locked', '1');
      await t.style('body', 'overflow', 'hidden');
    });
    await t.step('focus stays trapped in the dialog', async () => {
      for (let i = 0; i < 5; i++) await t.press('Tab');
      await t.eval(() => document.querySelector('#rd-content').contains(document.activeElement), true, 'focus is still inside the dialog after tabbing');
    });
    await t.step('a controlled input inside the portal', async () => {
      await t.type('#rd-name', 'grace');
      await t.value('#rd-name', 'grace');
      await t.click('#rd-save');
      await t.gone('#rd-content');
      await t.text('#rd-saved', 'grace');
      await t.focus('rd-open');
    });
    await t.step('a popover inside the dialog: a press in its portal is not outside the dialog', async () => {
      await t.click('#rd-open');
      await t.present('#rd-content');
      await t.value('#rd-name', 'grace');
      await t.click('#rd-nested-open');
      await t.present('#rd-nested');
      await t.sleep(200);
      await t.click('#rd-nested-btn');
      await t.click('#rd-nested-btn');
      await t.text('#rd-nested-btn', 'inside 2');
      await t.present('#rd-content');
      await t.press('Escape');
      await t.gone('#rd-nested');
      await t.present('#rd-content');
    });
    await t.step('Escape closes and returns focus to the trigger', async () => {
      await t.press('Escape');
      await t.gone('#rd-content');
      await t.gone('#rd-overlay');
      await t.focus('rd-open');
      await t.text('#rd-state', 'closed');
      await t.eval(() => document.body.hasAttribute('data-scroll-locked'), false, 'the scroll lock is released');
    });
    await t.step('the popover is positioned and closes on an outside press', async () => {
      await t.click('#rp-open');
      await t.attr('#rp-content', 'data-state', 'open');
      await t.eval(() => { const w = document.querySelector('[data-radix-popper-content-wrapper]'); return /translate\((?!0px, 0px)/.test(w.style.transform) || w.getBoundingClientRect().top > 0; }, true, 'the popover is positioned');
      await t.attr('#rp-content', 'data-side', /bottom|top/);
      // Radix starts listening for outside presses a tick after the layer mounts.
      await t.sleep(200);
      await t.page.mouse.click(700, 600);
      await t.gone('#rp-content');
    });
    await t.step('the tooltip opens on hover', async () => {
      await t.hover('#rt-trigger');
      await t.eval(() => document.querySelector('[role="tooltip"]')?.textContent, 'Tip text');
      await t.attr('#rt-trigger', 'aria-describedby', /.+/);
    });
  },
};
