export default {
  packages: ['styled-components'],
  exercised: 'styles from props and from `ThemeProvider`, a prop change and a theme change restyling in place, `styled(Component)`, `css`, `as`, `.attrs`, transient `$props` kept off the DOM, `createGlobalStyle` mounted and unmounted, `keyframes`, a controlled styled input keeping focus, a ref to a styled element, the event a styled button passes on, `useTheme` in an effect, a keyed list of styled items reordered',
  async run(t) {
    await t.step('styles from props and theme', async () => {
      await t.style('#sc-btn', 'backgroundColor', 'rgb(200, 0, 0)');
      await t.style('#sc-btn', 'color', 'rgb(255, 255, 255)');
      await t.style('#sc-btn', 'paddingLeft', '8px');
      await t.style('#sc-big', 'fontSize', '30px');
      await t.style('#sc-big', 'width', '200px');
      await t.style('body', 'marginTop', '0px');
      await t.style('body', 'letterSpacing', '1px');
    });
    await t.step('`as`, `.attrs` and transient props', async () => {
      await t.eval(() => document.querySelector('#sc-link').tagName, 'A');
      await t.attr('#sc-field', 'placeholder', 'styled');
      await t.eval(() => document.querySelector('#sc-btn').getAttributeNames().filter((n) => n.startsWith('$') || n === 'primary').length, 0);
      await t.style('#sc-spin', 'animationDuration', '1s');
      await t.eval(() => getComputedStyle(document.querySelector('#sc-spin')).animationName !== 'none', true);
    });
    await t.step('a prop change restyles the same element', async () => {
      await t.page.evaluate(() => { window.__btn = document.querySelector('#sc-btn'); });
      await t.click('#sc-btn');
      await t.style('#sc-btn', 'backgroundColor', 'rgb(255, 255, 255)');
      await t.style('#sc-btn', 'color', 'rgb(0, 0, 0)');
      await t.click('#sc-btn');
      await t.style('#sc-btn', 'backgroundColor', 'rgb(200, 0, 0)');
      await t.eval(() => window.__btn === document.querySelector('#sc-btn'), true);
    });
    await t.step('a theme change reaches every styled component', async () => {
      await t.click('#sc-theme');
      await t.style('#sc-btn', 'backgroundColor', 'rgb(0, 0, 200)');
      await t.style('#sc-big', 'backgroundColor', 'rgb(0, 0, 200)');
      await t.style('#sc-field', 'borderTopColor', 'rgb(0, 0, 200)');
    });
    await t.step('a controlled styled input keeps focus while typing', async () => {
      await t.click('#sc-field');
      await t.type('#sc-field', 'hello');
      await t.value('#sc-field', 'hello');
      await t.text('#sc-text', 'hello');
      await t.focus('sc-field');
    });
    await t.step('a ref to a styled component is its element', async () => {
      await t.text('#sc-tag', 'INPUT:styled');
      await t.click('#sc-focus');
      await t.focus('sc-field');
    });
    await t.step('a styled button hands its handler React\'s event', async () => {
      await t.click('#sc-btn');
      await t.text('#sc-event', 'sc-btn:click:function');
    });
    await t.step('useTheme in an effect sees each theme once', async () => {
      await t.text('#sc-seen', 'rgb(200, 0, 0)|rgb(0, 0, 200)');
      await t.click('#sc-theme');
      await t.text('#sc-seen', 'rgb(200, 0, 0)|rgb(0, 0, 200)|rgb(200, 0, 0)');
      await t.style('.sc-item', 'borderLeftColor', 'rgb(200, 0, 0)');
    });
    await t.step('a keyed list of styled items moves its elements', async () => {
      const notes = () => [...document.querySelectorAll('.sc-note')].map((i) => i.value).join(',');
      await t.page.locator('.sc-note').first().fill('a!');
      await t.page.evaluate(() => { window.__items = [...document.querySelectorAll('.sc-item')]; });
      await t.click('#sc-reverse');
      await t.eval(() => [...document.querySelectorAll('.sc-item')].map((li) => li.dataset.id).join(','), 'c,b,a');
      await t.eval(notes, 'c,b,a!', 'what was typed moved with its item');
      await t.eval(() => { const now = [...document.querySelectorAll('.sc-item')]; return now[0] === window.__items[2] && now[1] === window.__items[1] && now[2] === window.__items[0]; }, true, 'the same three elements, in the new order');
    });
    await t.step('a global style leaves with its component', async () => {
      await t.style('body', 'letterSpacing', '1px');
      await t.click('#sc-global');
      await t.style('body', 'letterSpacing', 'normal');
      await t.click('#sc-global');
      await t.style('body', 'letterSpacing', '1px');
    });
  },
};
