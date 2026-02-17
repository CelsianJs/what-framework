// Settings — showcases: useForm, validation rules, stores, signals, theme toggle, accessibility, announce
import {
  h, useState, useEffect, useMemo,
  signal, effect,
  useForm, rules, simpleResolver,
  announce,
  useLocalStorage,
} from 'what-framework';
import { useAppStore } from '../app.js';

// ─── Profile Form ───
function ProfileForm() {
  const store = useAppStore();

  const { register, handleSubmit, formState, reset, setValue } = useForm({
    defaultValues: {
      name: 'Elena Vasquez',
      email: 'elena@flux.dev',
      role: 'Lead Engineer',
      bio: 'Building beautiful things with What Framework.',
    },
    mode: 'onChange',
    resolver: simpleResolver({
      name: [rules.required('Name is required'), rules.minLength(2, 'At least 2 characters')],
      email: [rules.required('Email is required'), rules.email('Invalid email address')],
      role: [rules.required('Role is required')],
      bio: [rules.maxLength(200, 'Max 200 characters')],
    }),
  });

  const [saved, setSaved] = useState(false);

  const onSubmit = (data) => {
    setSaved(true);
    store.addNotification('Profile updated successfully', 'success');
    setTimeout(() => setSaved(false), 2000);
  };

  const errors = formState.errors;
  const values = formState.values;
  const isDirty = formState.isDirty();
  const isSubmitting = formState.isSubmitting();

  return h('div', null,
    h('div', { class: 'settings-section' },
      h('h3', { class: 'settings-section-title' }, 'Profile'),
      h('p', { class: 'settings-section-desc' }, 'Your personal information and public profile.'),

      h('form', { onSubmit: handleSubmit(onSubmit) },
        h('div', { class: 'form-group' },
          h('label', { class: 'form-label' }, 'Full Name'),
          h('input', {
            ...register('name'),
            class: `form-input${errors.name ? ' error' : ''}`,
          }),
          errors.name
            ? h('div', { class: 'form-error', role: 'alert' }, errors.name?.message)
            : null,
        ),

        h('div', { class: 'form-group' },
          h('label', { class: 'form-label' }, 'Email'),
          h('input', {
            ...register('email'),
            type: 'email',
            class: `form-input${errors.email ? ' error' : ''}`,
          }),
          errors.email
            ? h('div', { class: 'form-error', role: 'alert' }, errors.email?.message)
            : null,
        ),

        h('div', { class: 'form-group' },
          h('label', { class: 'form-label' }, 'Role'),
          h('input', {
            ...register('role'),
            class: `form-input${errors.role ? ' error' : ''}`,
          }),
          errors.role
            ? h('div', { class: 'form-error', role: 'alert' }, errors.role?.message)
            : null,
        ),

        h('div', { class: 'form-group' },
          h('label', { class: 'form-label' }, 'Bio'),
          h('textarea', {
            ...register('bio'),
            class: `form-input${errors.bio ? ' error' : ''}`,
            rows: 3,
          }),
          h('div', { class: 'flex justify-between' },
            errors.bio
              ? h('div', { class: 'form-error', role: 'alert' }, errors.bio?.message)
              : null,
            h('div', { class: 'form-hint', style: 'margin-left: auto;' },
              `${(values.bio || '').length}/200`,
            ),
          ),
        ),

        h('div', { class: 'flex gap-2 mt-4' },
          h('button', {
            type: 'submit',
            class: 'btn btn-primary',
            disabled: !isDirty || isSubmitting,
          },
            isSubmitting ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes',
          ),
          h('button', {
            type: 'button',
            class: 'btn',
            onClick: () => reset(),
          }, 'Reset'),
        ),
      ),
    ),
  );
}

// ─── Appearance Settings ───
function AppearanceSettings() {
  const store = useAppStore();

  return h('div', { class: 'settings-section' },
    h('h3', { class: 'settings-section-title' }, 'Appearance'),
    h('p', { class: 'settings-section-desc' }, 'Customize how Flux looks on your device.'),

    h('div', { class: 'form-group' },
      h('label', { class: 'form-label' }, 'Theme'),
      h('div', { class: 'theme-options' },
        h('div', {
          class: `theme-option dark-theme${store.isDark ? ' active' : ''}`,
          onClick: () => { store.setTheme('dark'); announce('Dark theme selected'); },
          role: 'radio',
          'aria-checked': store.isDark ? 'true' : 'false',
          'aria-label': 'Dark theme',
          tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.setTheme('dark'); } },
        },
          h('span', { class: 'theme-label' }, 'Dark'),
        ),
        h('div', {
          class: `theme-option light-theme${!store.isDark ? ' active' : ''}`,
          onClick: () => { store.setTheme('light'); announce('Light theme selected'); },
          role: 'radio',
          'aria-checked': !store.isDark ? 'true' : 'false',
          'aria-label': 'Light theme',
          tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); store.setTheme('light'); } },
        },
          h('span', { class: 'theme-label' }, 'Light'),
        ),
      ),
    ),
  );
}

// ─── Notification Settings ───
function NotificationSettings() {
  const [emailNotifs, setEmailNotifs] = useState(true);
  const [pushNotifs, setPushNotifs] = useState(false);
  const [weeklyDigest, setWeeklyDigest] = useState(true);
  const [mentions, setMentions] = useState(true);
  const store = useAppStore();

  const toggleSetting = (name, getter, setter) => {
    const newVal = !getter;
    setter(newVal);
    store.addNotification(`${name} ${newVal ? 'enabled' : 'disabled'}`, 'info');
  };

  return h('div', { class: 'settings-section' },
    h('h3', { class: 'settings-section-title' }, 'Notifications'),
    h('p', { class: 'settings-section-desc' }, 'Choose what notifications you receive.'),

    h('div', null,
      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-info' },
          h('div', { class: 'setting-name' }, 'Email notifications'),
          h('div', { class: 'setting-desc' }, 'Receive email updates about task changes'),
        ),
        h('label', { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: emailNotifs,
            onChange: () => toggleSetting('Email notifications', emailNotifs, setEmailNotifs),
          }),
          h('span', { class: 'toggle-track' },
            h('span', { class: 'toggle-thumb' }),
          ),
        ),
      ),

      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-info' },
          h('div', { class: 'setting-name' }, 'Push notifications'),
          h('div', { class: 'setting-desc' }, 'Receive push notifications in your browser'),
        ),
        h('label', { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: pushNotifs,
            onChange: () => toggleSetting('Push notifications', pushNotifs, setPushNotifs),
          }),
          h('span', { class: 'toggle-track' },
            h('span', { class: 'toggle-thumb' }),
          ),
        ),
      ),

      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-info' },
          h('div', { class: 'setting-name' }, 'Weekly digest'),
          h('div', { class: 'setting-desc' }, 'Get a summary of your week every Monday'),
        ),
        h('label', { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: weeklyDigest,
            onChange: () => toggleSetting('Weekly digest', weeklyDigest, setWeeklyDigest),
          }),
          h('span', { class: 'toggle-track' },
            h('span', { class: 'toggle-thumb' }),
          ),
        ),
      ),

      h('div', { class: 'setting-row' },
        h('div', { class: 'setting-info' },
          h('div', { class: 'setting-name' }, 'Mentions only'),
          h('div', { class: 'setting-desc' }, 'Only notify when someone mentions you'),
        ),
        h('label', { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: mentions,
            onChange: () => toggleSetting('Mentions only', mentions, setMentions),
          }),
          h('span', { class: 'toggle-track' },
            h('span', { class: 'toggle-thumb' }),
          ),
        ),
      ),
    ),
  );
}

// ─── Keyboard Shortcuts Info ───
function ShortcutsInfo() {
  const shortcuts = [
    { keys: '⌘ K', desc: 'Open command palette' },
    { keys: 'G D', desc: 'Go to Dashboard' },
    { keys: 'G P', desc: 'Go to Projects' },
    { keys: 'G T', desc: 'Go to Team' },
    { keys: 'G S', desc: 'Go to Settings' },
    { keys: 'T T', desc: 'Toggle theme' },
  ];

  return h('div', { class: 'settings-section' },
    h('h3', { class: 'settings-section-title' }, 'Keyboard Shortcuts'),
    h('p', { class: 'settings-section-desc' }, 'Navigate faster with keyboard shortcuts.'),

    h('div', null,
      ...shortcuts.map(s =>
        h('div', { class: 'setting-row' },
          h('div', { class: 'setting-name' }, s.desc),
          h('div', null,
            ...s.keys.split(' ').map((k, i) => [
              i > 0 ? h('span', { class: 'text-muted text-xs', style: 'margin: 0 4px;' }, 'then') : null,
              h('kbd', {
                style: {
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '3px 8px',
                  background: 'var(--bg-hover)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                },
              }, k),
            ]).flat().filter(Boolean),
          ),
        ),
      ),
    ),
  );
}

// ─── Framework Info ───
function FrameworkInfo() {
  return h('div', { class: 'settings-section' },
    h('h3', { class: 'settings-section-title' }, 'About'),
    h('p', { class: 'settings-section-desc' }, 'This showcase app is built entirely with What Framework.'),

    h('div', { style: 'display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;' },
      ...[
        { label: 'Framework', value: 'What Framework v1.0' },
        { label: 'Core Size', value: '~4kB gzipped' },
        { label: 'Dependencies', value: '0' },
        { label: 'Modules Used', value: '14' },
      ].map(item =>
        h('div', {
          style: {
            padding: '12px',
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          },
        },
          h('div', { class: 'text-xs text-muted', style: 'margin-bottom: 4px' }, item.label),
          h('div', { class: 'text-sm font-semibold' }, item.value),
        ),
      ),
    ),

    h('div', { class: 'mt-4' },
      h('p', { class: 'text-sm text-secondary', style: 'line-height: 1.7;' },
        'Features demonstrated: signals, computed, effects, stores, spring animations, ',
        'data fetching (SWR), form validation, accessibility (announce, ARIA), router, ',
        'theme switching, skeleton loaders, command palette, drag-and-drop, and more — ',
        'all from a framework that\'s smaller than most images.',
      ),
    ),
  );
}

// ─── Settings Page ───
export function Settings() {
  const [activeSection, setActiveSection] = useState('profile');

  const sections = [
    { id: 'profile', label: 'Profile' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'about', label: 'About' },
  ];

  return h('div', { class: 'settings-layout' },
    // Settings nav
    h('nav', null,
      h('ul', { class: 'settings-nav', role: 'tablist' },
        ...sections.map(s =>
          h('li', {
            class: `settings-nav-item${activeSection === s.id ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': activeSection === s.id ? 'true' : 'false',
            tabIndex: 0,
            onClick: () => setActiveSection(s.id),
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveSection(s.id); } },
          }, s.label),
        ),
      ),
    ),

    // Settings content
    h('div', { role: 'tabpanel' },
      activeSection === 'profile' ? h(ProfileForm) : null,
      activeSection === 'appearance' ? h(AppearanceSettings) : null,
      activeSection === 'notifications' ? h(NotificationSettings) : null,
      activeSection === 'shortcuts' ? h(ShortcutsInfo) : null,
      activeSection === 'about' ? h(FrameworkInfo) : null,
    ),
  );
}
