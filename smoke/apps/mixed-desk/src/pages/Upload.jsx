// Trade files through react-dropzone; what it accepts lands in the store.

import { signal } from 'what-framework';

import { uploads } from '../store.js';
import { Dropzone } from '../react/Dropzone.jsx';

export function Upload() {
  const rejected = signal(0);
  return (
    <section data-route="upload">
      <h1>Upload trades</h1>
      <Dropzone onFiles={(files, refused) => { uploads([...uploads(), ...files]); rejected(rejected() + refused); }} />
      <ul data-uploads>{uploads().map((f) => <li data-upload={f.name}>{f.name} ({f.size} B)</li>)}</ul>
      <p>Refused: <b data-refused>{rejected()}</b></p>
    </section>
  );
}
