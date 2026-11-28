const toasts = () => [...document.querySelectorAll('[data-sonner-toast]')].map((el) => el.textContent);

export default {
  packages: ['sonner'],
  exercised: '`toast()` from event handlers into `<Toaster>`: plain, success with description, an action button, `toast.promise` loading then success, a JSX toast, measured stacking, dismiss one and dismiss all with exit removal',
  async run(t) {
    await t.step('a toast mounts and is measured', async () => {
      await t.click('#so-plain');
      await t.until(() => t.page.evaluate(toasts), (list) => list.length === 1 && list[0].includes('Event created'), 'one toast with its text');
      await t.attr('[data-sonner-toast]', 'data-mounted', 'true');
      await t.eval(() => parseFloat(document.querySelector('[data-sonner-toast]').style.getPropertyValue('--initial-height')) > 0, true, 'the toast height was measured');
    });
    await t.step('a success toast stacks in front', async () => {
      await t.click('#so-success');
      await t.count('[data-sonner-toast]', 2);
      await t.eval(() => document.querySelector('[data-sonner-toast][data-type="success"]')?.textContent, /Saved.*All changes stored/);
      await t.eval(() => document.querySelector('[data-sonner-toast][data-front="true"]')?.dataset.type, 'success');
    });
    await t.step('an action button runs and dismisses its toast', async () => {
      await t.click('#so-action');
      await t.count('[data-sonner-toast]', 3);
      await t.page.getByRole('button', { name: 'Undo' }).click();
      await t.text('#so-undone', 'true');
      await t.count('[data-sonner-toast]', 2);
    });
    await t.step('toast.promise goes from loading to success', async () => {
      await t.page.mouse.move(10, 700);
      await t.click('#so-promise');
      await t.until(() => t.page.evaluate(toasts), (list) => list.some((x) => x.includes('Loading')), 'a loading toast');
      await t.until(() => t.page.evaluate(toasts), (list) => list.some((x) => x.includes('Done 42')) && !list.some((x) => x.includes('Loading')), 'the loading toast became Done 42');
    });
    await t.step('a JSX toast, dismissed by id', async () => {
      await t.click('#so-custom');
      await t.present('#so-jsx');
      await t.click('#so-jsx-close');
      await t.gone('#so-jsx');
    });
    await t.step('dismiss all removes every toast', async () => {
      await t.page.mouse.move(10, 700);
      await t.click('#so-dismiss');
      await t.count('[data-sonner-toast]', 0);
    });
  },
};
