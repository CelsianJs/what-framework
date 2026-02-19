import React from 'react';
import { IntlProvider, FormattedMessage, FormattedNumber, FormattedDate, useIntl } from 'react-intl';

const messages = {
  en: {
    greeting: 'Hello, {name}!',
    items: 'You have {count, plural, one {# item} other {# items}} in your cart.',
  },
};

function IntlDemo() {
  const intl = useIntl();

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <strong>FormattedMessage:</strong>{' '}
        <FormattedMessage id="greeting" values={{ name: <strong>Developer</strong> }} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>Plural:</strong>{' '}
        <FormattedMessage id="items" values={{ count: 5 }} />
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>FormattedNumber:</strong>{' '}
        <FormattedNumber value={1234567.89} style="currency" currency="USD" />
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>FormattedDate:</strong>{' '}
        <FormattedDate value={new Date()} year="numeric" month="long" day="numeric" />
      </div>
      <div style={{ marginBottom: 8 }}>
        <strong>useIntl:</strong>{' '}
        {intl.formatMessage({ id: 'greeting' }, { name: 'Hook User' })}
      </div>
    </div>
  );
}

export function IntlTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>react-intl (FormatJS)</h3>
      <IntlProvider locale="en" messages={messages.en}>
        <IntlDemo />
      </IntlProvider>
      <p style={{ color: 'green', fontWeight: 'bold' }}>PASS — react-intl renders with formatting</p>
    </div>
  );
}
