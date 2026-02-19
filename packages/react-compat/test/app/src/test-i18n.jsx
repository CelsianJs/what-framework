/**
 * Test: react-i18next — i18n framework integration for React
 * 4.5M weekly downloads. Context Provider + hooks (useTranslation).
 */
import { useState } from 'react';
import i18n from 'i18next';
import { initReactI18next, useTranslation, I18nextProvider } from 'react-i18next';

// Initialize i18next
i18n.use(initReactI18next).init({
  resources: {
    en: {
      translation: {
        greeting: 'Hello, World!',
        description: 'This is rendered using react-i18next on What Framework.',
        button: 'Switch Language',
        count: 'You clicked {{count}} times',
      },
    },
    es: {
      translation: {
        greeting: '¡Hola, Mundo!',
        description: 'Esto se renderiza usando react-i18next en What Framework.',
        button: 'Cambiar Idioma',
        count: 'Hiciste clic {{count}} veces',
      },
    },
    ja: {
      translation: {
        greeting: 'こんにちは、世界！',
        description: 'これはWhat Framework上でreact-i18nextを使用してレンダリングされています。',
        button: '言語を切り替え',
        count: '{{count}}回クリックしました',
      },
    },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

function TranslatedContent() {
  const { t, i18n: i18nInstance } = useTranslation();
  const [count, setCount] = useState(0);
  const langs = ['en', 'es', 'ja'];

  return (
    <div>
      <h3 style={{ margin: '0 0 4px' }}>{t('greeting')}</h3>
      <p style={{ color: '#666', fontSize: '13px' }}>{t('description')}</p>
      <p style={{ fontSize: '13px' }}>{t('count', { count })}</p>
      <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
        <button
          onclick={() => setCount(c => c + 1)}
          style={{ padding: '4px 12px', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer' }}
        >
          +1
        </button>
        {langs.map(lang => (
          <button
            key={lang}
            onclick={() => i18nInstance.changeLanguage(lang)}
            style={{
              padding: '4px 12px', borderRadius: '4px', cursor: 'pointer',
              border: i18nInstance.language === lang ? '2px solid #3b82f6' : '1px solid #ccc',
              background: i18nInstance.language === lang ? '#eff6ff' : 'white',
              fontWeight: i18nInstance.language === lang ? 600 : 400,
            }}
          >
            {lang.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

export function I18nTest() {
  return (
    <I18nextProvider i18n={i18n}>
      <TranslatedContent />
      <p style={{ color: 'green' }} id="i18n-status">react-i18next loaded OK</p>
    </I18nextProvider>
  );
}
