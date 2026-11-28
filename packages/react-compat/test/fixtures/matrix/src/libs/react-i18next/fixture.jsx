import { useState } from 'react';
import i18next from 'i18next';
import { I18nextProvider, Trans, initReactI18next, useTranslation } from 'react-i18next';

const i18n = i18next.createInstance();
i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  resources: {
    en: { translation: { hello: 'Hello {{name}}', items_one: '{{count}} item', items_other: '{{count}} items', rich: 'Read <1>the docs</1> now', only: 'English only' }, extra: { title: 'Extra' } },
    fr: { translation: { hello: 'Bonjour {{name}}', items_one: '{{count}} article', items_other: '{{count}} articles', rich: 'Lisez <1>la doc</1> maintenant' }, extra: { title: 'Supplément' } },
  },
});
window.i18n = i18n;

function Greeting() {
  const { t, i18n: instance } = useTranslation();
  const [count, setCount] = useState(1);
  return (
    <div>
      <h1 id="i-hello">{t('hello', { name: 'Ada' })}</h1>
      <p id="i-count">{t('items', { count })}</p>
      <button id="i-more" onClick={() => setCount(count + 1)}>more</button>
      <p id="i-rich"><Trans i18nKey="rich">Read <a id="i-link" href="/docs">the docs</a> now</Trans></p>
      <p id="i-only">{t('only')}</p>
      <span id="i-lang">{instance.language}</span>
      <button id="i-fr" onClick={() => instance.changeLanguage('fr')}>fr</button>
      <button id="i-en" onClick={() => instance.changeLanguage('en')}>en</button>
    </div>
  );
}

function Extra() {
  const { t } = useTranslation('extra');
  return <h2 id="i-extra">{t('title')}</h2>;
}

export default function Fixture() {
  return (
    <I18nextProvider i18n={i18n}>
      <Greeting />
      <Extra />
    </I18nextProvider>
  );
}
