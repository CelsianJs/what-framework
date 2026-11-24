const slots = () => [...document.querySelectorAll('.otp-slot')].map((s) => `${s.textContent}${s.dataset.active === 'true' ? '*' : ''}`).join(' ');

export default {
  packages: ['input-otp'],
  exercised: 'a controlled one-time-code input: a hidden real input driving rendered slots, the active slot and caret following the selection, a pattern rejecting letters, Backspace, `onComplete`, a reset from outside',
  async run(t) {
    await t.step('focus marks the first slot active', async () => {
      await t.count('.otp-slot', 4);
      await t.page.focus('#otp');
      await t.focus('otp');
      await t.eval(slots, '|*   ');
    });
    await t.step('typing fills the slots and moves the active one; letters are refused', async () => {
      await t.press('1');
      await t.press('a');
      await t.press('2');
      await t.text('#otp-value', '12');
      await t.eval(slots, '1 2 |* ');
    });
    await t.step('Backspace removes the last character', async () => {
      await t.press('Backspace');
      await t.text('#otp-value', '1');
      await t.eval(slots, '1 |*  ');
    });
    await t.step('completing the code calls onComplete', async () => {
      await t.press('3');
      await t.press('5');
      await t.press('7');
      await t.text('#otp-value', '1357');
      await t.text('#otp-done', '1357');
    });
    await t.step('a reset from outside empties the slots', async () => {
      await t.click('#otp-clear');
      await t.text('#otp-value', '');
      await t.eval(() => [...document.querySelectorAll('.otp-slot')].map((s) => s.textContent.replace('|', '')).join(''), '');
      await t.value('#otp', '');
    });
  },
};
