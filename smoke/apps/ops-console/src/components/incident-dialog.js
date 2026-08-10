// "Declare incident" dialog: a Portal out to #dialog-root, a FocusTrap around
// the card, and a useForm that refuses to submit a title nobody could act on.
//
// The whole component is mounted and unmounted rather than toggled: FocusTrap
// destructures `active` once and components run once, so flipping that prop
// would do nothing. Mount/unmount is the supported way to open and close.

import {
  FocusTrap,
  Portal,
  h,
  rules,
  signal,
  simpleResolver,
  useForm,
  useId,
} from 'what-framework';

export function IncidentDialog({ services, severities, onClose, onCreate }) {
  const titleId = useId('dialog-title');
  const errorId = useId('dialog-error');
  const submitting = signal(false, 'dialog:submitting');
  const serverError = signal('', 'dialog:serverError');

  const form = useForm({
    defaultValues: { title: '', service: services[0], severity: 'major' },
    resolver: simpleResolver({
      title: [
        rules.required('Give the incident a title.'),
        rules.minLength(10, 'Use at least 10 characters: this is what the pager shows at 3am.'),
      ],
    }),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    submitting(true);
    serverError('');
    try {
      await onCreate(values);
    } catch (err) {
      serverError(err.message);
    } finally {
      submitting(false);
    }
  });

  // Never `...register(name)`: `value` is a defineProperty getter, so spreading
  // it snapshots the value at component-creation time (components run once) and
  // the control stops tracking reset()/setValue().
  const bind = (name) => ({
    oninput: form.register(name).oninput,
    onblur: form.register(name).onBlur,
  });

  const textField = (name) => ({ ...bind(name), value: () => form.getValue(name) });

  const option = (name) => (value) =>
    h('option', {
      key: value,
      value,
      ...(form.getValue(name) === value ? { selected: true } : {}),
    }, value);

  // One ELEMENT child, never a component and never a list. A component realizes
  // to a DocumentFragment, and appending a fragment empties it, so Portal's
  // cleanup ends up holding an empty fragment and removes nothing: the dialog
  // stays in #dialog-root after close and the next open stacks a second one.
  // Wrapping everything in a real element gives the cleanup a node to remove.
  const card = h('div', {
    class: 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId(),
    'data-dialog': '',
    onkeydown: (event) => { if (event.key === 'Escape') onClose(); },
  },
    h('div', { class: 'dialog-head' },
      h('h2', { id: titleId() }, 'Declare incident'),
      h('button', {
        type: 'button',
        class: 'icon-button',
        'aria-label': 'Close dialog',
        'data-dialog-close': '',
        onclick: onClose,
      }, '×'),
    ),

    h('form', { class: 'dialog-body', onsubmit: onSubmit, 'data-dialog-form': '' },
      h('label', { class: 'field' },
        h('span', {}, 'What is happening?'),
        h('input', {
          type: 'text',
          name: 'title',
          placeholder: 'checkout-api: 5xx on POST /orders',
          autocomplete: 'off',
          'data-dialog-title': '',
          'aria-describedby': errorId(),
          ...textField('title'),
        }),
      ),

      h('div', { class: 'field-row' },
        h('label', { class: 'field' },
          h('span', {}, 'Service'),
          h('select', { name: 'service', 'data-dialog-service': '', ...bind('service') },
            services.map(option('service')),
          ),
        ),
        h('label', { class: 'field' },
          h('span', {}, 'Severity'),
          h('select', { name: 'severity', 'data-dialog-severity': '', ...bind('severity') },
            severities.map(option('severity')),
          ),
        ),
      ),

      // One error slot, reactive text. `role="alert"` so the message is
      // announced the moment validation writes it.
      h('p', {
        id: errorId(),
        class: 'field-error',
        role: 'alert',
        'data-dialog-error': '',
      }, () => form.formState.error('title')?.message || serverError()),

      h('div', { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'ghost', onclick: onClose }, 'Cancel'),
        h('button', {
          type: 'submit',
          class: 'primary',
          'data-dialog-submit': '',
        }, () => (submitting() ? 'Declaring...' : 'Declare incident')),
      ),
    ),
  );

  return h(Portal, { target: '#dialog-root' },
    h('div', { class: 'dialog-layer' },
      h('div', { class: 'scrim', onclick: onClose, 'aria-hidden': 'true' }),
      h(FocusTrap, {}, card),
    ),
  );
}
