// What ProseMirror shows against what its document holds: the editor's text
// read back from the DOM (chips by their label) and from the state's readout.
const shown = () => {
  const root = document.querySelector('.ProseMirror');
  return root ? root.innerText.replace(/\u00a0/g, ' ').replace(/\n+/g, '|').trim() : null;
};
const strong = () => [...document.querySelectorAll('.ProseMirror strong')].map((s) => s.textContent).join(',');

export default {
  packages: ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/pm'],
  exercised: 'A ProseMirror editor (StarterKit): typing, bold from a toolbar button and from Mod-b, undo and redo from a button and the keyboard, a toolbar that follows the selection (`useEditorState`), and two React node views drawn inside ProseMirror\'s DOM: an inline chip that marks itself when selected, a block whose hint shows while its editable content is empty',
  async run(t) {
    const mod = 'ControlOrMeta';
    await t.step('the editor mounts with its content and the toolbar', async () => {
      await t.present('.ProseMirror');
      await t.text('#tt-text', 'Hello');
      await t.attr('#tt-bold', 'aria-pressed', 'false');
      await t.eval(() => document.querySelector('#tt-undo').disabled, true, 'nothing to undo');
    });
    await t.step('typing at the end of the line', async () => {
      await t.click('.ProseMirror p');
      await t.press('End');
      await t.page.keyboard.type(' world');
      await t.text('#tt-text', 'Hello world');
      await t.eval(shown, 'Hello world');
      await t.eval(() => document.querySelector('#tt-undo').disabled, false, 'the typing can be undone');
    });
    await t.step('bold from the toolbar formats the selection, and the toolbar follows it', async () => {
      // A new history event: ProseMirror groups changes made within 500 ms.
      await t.sleep(600);
      for (let i = 0; i < 5; i++) await t.press('Shift+ArrowLeft');
      await t.click('#tt-bold');
      await t.eval(strong, 'world');
      await t.attr('#tt-bold', 'aria-pressed', 'true');
      await t.present('#tt-bold-on');
      await t.focus(/./);
      await t.eval(() => document.activeElement === document.querySelector('.ProseMirror'), true, 'the editor kept focus');
    });
    await t.step('Mod-b over the whole line makes it all bold', async () => {
      await t.sleep(600);
      await t.press('Home');
      await t.gone('#tt-bold-on');
      await t.press('Shift+End');
      await t.press(`${mod}+b`);
      await t.eval(strong, 'Hello world');
      await t.text('#tt-text', 'Hello world');
    });
    await t.step('undo from the keyboard, then the button, takes the steps back in order; redo brings one again', async () => {
      await t.press(`${mod}+z`);
      await t.eval(strong, 'world');
      await t.click('#tt-undo');
      await t.eval(strong, '');
      await t.click('#tt-undo');
      await t.text('#tt-text', 'Hello');
      await t.eval(shown, 'Hello');
      await t.eval(() => document.querySelector('#tt-undo').disabled, true, 'nothing left to undo');
      await t.press(`${mod}+Shift+z`);
      await t.text('#tt-text', 'Hello world');
    });
    await t.step('a React node view inside the text: inserted, selected, typed after', async () => {
      await t.sleep(600);
      await t.press('End');
      await t.click('#tt-chip');
      await t.count('.ProseMirror .chip', 1);
      await t.text('#tt-count', '1 chips, 0 callouts');
      await t.text('.ProseMirror .chip', 'chip 1');
      await t.click('.ProseMirror .chip');
      await t.present('.ProseMirror .chip .chip-sel');
      await t.press('ArrowRight');
      await t.gone('.ProseMirror .chip-sel');
      await t.page.keyboard.type('!');
      await t.eval(shown, 'Hello worldchip 1!');
      await t.text('#tt-text', /^Hello world.*!$/);
    });
    await t.step('a React node view with editable content: its hint goes when it has text, and comes back on undo', async () => {
      await t.sleep(600);
      await t.click('#tt-callout');
      await t.text('#tt-count', '1 chips, 1 callouts');
      await t.present('.ProseMirror .callout .callout-empty');
      await t.sleep(600);
      await t.page.keyboard.type('note');
      await t.text('.ProseMirror .callout .callout-content', 'note');
      await t.gone('.ProseMirror .callout-empty');
      await t.sleep(600);
      await t.press(`${mod}+z`);
      await t.text('.ProseMirror .callout .callout-content', '');
      await t.present('.ProseMirror .callout .callout-empty');
      await t.page.keyboard.type('again');
      await t.text('.ProseMirror .callout .callout-content', 'again');
      await t.eval(() => document.querySelector('.ProseMirror .callout-icon')?.textContent, '!');
    });
  },
};
