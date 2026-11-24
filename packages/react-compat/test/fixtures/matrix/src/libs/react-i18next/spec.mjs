export default {
  packages: ['react-i18next', 'i18next'],
  exercised: '`useTranslation` with interpolation, plurals and a namespace, `<Trans>` with an element inside the translation, `changeLanguage` from a button and from outside React re-rendering every consumer, the fallback language',
  async run(t) {
    await t.step('first render in English', async () => {
      await t.text('#i-hello', 'Hello Ada');
      await t.text('#i-count', '1 item');
      await t.text('#i-rich', 'Read the docs now');
      await t.eval(() => { const a = document.querySelector('#i-rich a'); return a.textContent + '|' + a.getAttribute('href'); }, 'the docs|/docs');
      await t.text('#i-extra', 'Extra');
    });
    await t.step('plurals follow state', async () => {
      await t.click('#i-more');
      await t.text('#i-count', '2 items');
    });
    await t.step('changeLanguage re-renders every consumer', async () => {
      await t.click('#i-fr');
      await t.text('#i-hello', 'Bonjour Ada');
      await t.text('#i-count', '2 articles');
      await t.text('#i-rich', 'Lisez la doc maintenant');
      await t.eval(() => document.querySelector('#i-rich a').textContent, 'la doc');
      await t.text('#i-extra', 'Supplément');
      await t.text('#i-lang', 'fr');
      await t.text('#i-only', 'English only');
    });
    await t.step('a change from outside React', async () => {
      await t.page.evaluate(() => window.i18n.changeLanguage('en'));
      await t.text('#i-hello', 'Hello Ada');
      await t.text('#i-count', '2 items');
      await t.text('#i-extra', 'Extra');
    });
  },
};
