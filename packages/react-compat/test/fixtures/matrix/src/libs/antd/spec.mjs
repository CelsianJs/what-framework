const names = () => [...document.querySelectorAll('#an-table tbody tr.ant-table-row td:first-child')].map((td) => td.textContent).join(',');

export default {
  packages: ['antd'],
  exercised: 'CSS-in-JS theme token on a Button, a controlled Input with clear, Select (dropdown portal, pick), Modal (portal, OK closes, `message.useMessage`), Form validation fail then pass, Table sort and pagination, Tabs, the static `message.info`',
  async run(t) {
    await t.step('the theme token styles the button', async () => {
      await t.style('#an-btn', 'backgroundColor', 'rgb(0, 185, 107)');
      await t.click('#an-btn');
      await t.text('#an-btn', /Clicked 1/);
    });
    await t.step('a controlled Input, and its clear button', async () => {
      await t.click('#an-input');
      await t.type('#an-input', 'hello');
      await t.value('#an-input', 'hello');
      await t.text('#an-echo', 'hello');
      await t.focus('an-input');
      await t.click('.ant-input-clear-icon');
      await t.value('#an-input', '');
      await t.text('#an-echo', '');
    });
    await t.step('a Select opens its dropdown in a portal and picks', async () => {
      await t.page.locator('.ant-select').first().click();
      await t.count('.ant-select-dropdown .ant-select-item-option', 3);
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('.ant-select-dropdown')), true, 'the dropdown is in a portal');
      await t.click('.ant-select-item-option[title="Pro"]');
      await t.text('#an-plan', 'pro');
      await t.eval(() => document.querySelector('.ant-select').textContent.includes('Pro'), true, 'the select shows Pro');
    });
    await t.step('a Modal opens in a portal; OK closes it and shows a message', async () => {
      await t.click('#an-open');
      await t.text('#an-modal-body', 'Are you sure?');
      await t.eval(() => document.querySelector('.ant-modal [role="dialog"], [role="dialog"].ant-modal, .ant-modal') !== null && !document.querySelector('#main').contains(document.querySelector('#an-modal-body')), true, 'the modal is in a portal');
      await t.page.getByRole('button', { name: 'Yes' }).click();
      await t.eval(() => { const b = document.querySelector('#an-modal-body'); return b === null || b.getClientRects().length === 0; }, true, 'the modal is hidden');
      await t.eval(() => document.querySelector('.ant-message')?.textContent ?? null, /Confirmed/);
    });
    await t.step('Form validation fails, then passes', async () => {
      await t.click('#an-submit');
      await t.text('.ant-form-item-explain-error', 'email is required');
      await t.text('#an-failed', '1');
      await t.click('#an-email');
      await t.type('#an-email', 'ada');
      await t.text('.ant-form-item-explain-error', 'not an email');
      await t.type('#an-email', '@x.io');
      await t.gone('.ant-form-item-explain-error');
      await t.click('#an-remember');
      await t.click('#an-submit');
      await t.text('#an-sent', '{"email":"ada@x.io","remember":true}');
    });
    await t.step('Table paginates and sorts', async () => {
      await t.eval(names, 'Linus,Ada,Grace');
      await t.click('.ant-pagination-item-2');
      await t.eval(names, 'Margaret');
      await t.click('.ant-pagination-item-1');
      await t.page.locator('#an-table th', { hasText: 'Name' }).click();
      await t.eval(names, 'Ada,Grace,Linus');
      await t.page.locator('#an-table th', { hasText: 'Age' }).click();
      await t.eval(names, 'Ada,Linus,Margaret');
    });
    await t.step('Tabs', async () => {
      await t.text('#an-tab', 'alpha panel');
      await t.page.getByRole('tab', { name: 'Beta' }).click();
      await t.eval(() => [...document.querySelectorAll('#an-tab')].filter((p) => p.getClientRects().length > 0).map((p) => p.textContent).join(','), 'beta panel');
    });
    await t.step('the static message API renders outside the tree', async () => {
      await t.click('#an-static');
      await t.eval(() => [...document.querySelectorAll('.ant-message-notice')].some((n) => n.textContent.includes('Static message')), true, 'the static message shows');
    });
  },
};
