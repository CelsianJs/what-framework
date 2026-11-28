// Step 7: documents. A photo of the license (a file input, which a reload
// cannot fill again, so it asks for the file again) and notes with a live
// character count. Errors show on Next.

import { Link } from 'what-router';

import { NOTES_MAX } from '../data.js';
import { licenseFile } from '../draft.js';
import { documentsResolver } from '../validation.js';
import { fieldError, previousStepPath, useStepForm } from '../step-form.js';

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

export function DocumentsStep() {
  const form = useStepForm('documents', {
    defaults: (d) => ({ notes: d.documents.notes, license: licenseFile() ? [licenseFile()] : '' }),
    collect: (v) => ({ notes: v.notes, licenseName: v.license && v.license.length ? String(v.license[0].name ?? '') : '' }),
    resolver: documentsResolver,
    mode: 'onSubmit',
    beforeNext: (values) => { licenseFile(values.license[0]); },
  });
  const { register, watch } = form;
  const notes = watch('notes');
  const license = watch('license');
  const chosen = () => (license() && license().length && license()[0] instanceof File ? license()[0] : null);
  return (
    <form data-step-form="documents" onSubmit={form.next} novalidate enctype="multipart/form-data">
      <h2>Documents</h2>
      <div class="field">
        <label for="f-license">Photo of your driver's license</label>
        <input id="f-license" type="file" accept="image/*" {...register('license')} />
        <span class="muted" data-license-chosen>{chosen() ? `${chosen().name} (${kb(chosen().size)})` : 'No file chosen yet. A reload asks for it again.'}</span>
        <span class="field-error" data-error="license" role="alert">{fieldError(form, 'license')}</span>
      </div>
      <div class="field">
        <label for="f-notes">Anything else we should know?</label>
        <textarea id="f-notes" rows="5" {...register('notes')} />
        <span class={String(notes()).length > NOTES_MAX ? 'counter over' : 'counter'} data-notes-count>{`${String(notes()).length} / ${NOTES_MAX}`}</span>
        <span class="field-error" data-error="notes" role="alert">{fieldError(form, 'notes')}</span>
      </div>
      <footer class="actions">
        <Link href={previousStepPath('documents')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}
