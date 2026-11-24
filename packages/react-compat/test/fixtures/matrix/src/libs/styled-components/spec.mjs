export default {
  packages: ['styled-components'],
  exercised: 'styles from props and from `ThemeProvider`, a prop change and a theme change restyling in place, `styled(Component)`, `css`, `as`, `.attrs`, transient `$props` kept off the DOM, `createGlobalStyle`, `keyframes`, a controlled styled input keeping focus',
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
  },
};
