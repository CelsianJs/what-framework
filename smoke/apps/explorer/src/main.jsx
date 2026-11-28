// Atlas Explorer: a repository's 10,000-entry file tree beside the publishing
// settings of its 50 packages. Client-only; index.html ships an empty #app.

import './styles.css';

import { mount } from 'what-framework';

import { FileTree } from './FileTree.jsx';
import { SettingsForm } from './SettingsForm.jsx';

function App() {
  return (
    <main class="page">
      <header class="masthead">
        <h1>Atlas Explorer</h1>
        <p class="muted">atlas monorepo · 10,000 entries · 50 packages</p>
      </header>
      <div class="split">
        <FileTree />
        <SettingsForm />
      </div>
    </main>
  );
}

mount(<App />, '#app');
