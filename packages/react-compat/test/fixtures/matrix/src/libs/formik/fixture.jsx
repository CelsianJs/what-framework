import { useEffect, useRef, useState } from 'react';
import { ErrorMessage, Field, FieldArray, Form, Formik, useField, useFormikContext } from 'formik';

function Upper({ name }) {
  const [field, meta, helpers] = useField(name);
  return (
    <span>
      <input id="f-code" value={field.value} onBlur={field.onBlur} name={name} onChange={(e) => helpers.setValue(e.target.value.toUpperCase())} />
      {meta.touched && meta.error ? <span id="f-code-error">{meta.error}</span> : null}
    </span>
  );
}

function Status() {
  const { dirty, isValid, submitCount, values } = useFormikContext();
  return <span id="f-status">{String(dirty)}|{String(isValid)}|{submitCount}|{values.friends.length}</span>;
}

// After a submit that failed, focus goes to the email field when it is the
// one in error: a ref (Field's innerRef), read in an effect.
function FocusOnError({ target }) {
  const { submitCount, errors } = useFormikContext();
  useEffect(() => {
    if (submitCount > 0 && errors.email && target.current) target.current.focus();
  }, [submitCount]);
  return null;
}

const first = { email: '', code: '', plan: 'free', agree: false, friends: ['bo'], pets: [{ id: 1, name: 'rex' }, { id: 2, name: 'tom' }] };
const loaded = { email: 'loaded@x.io', code: 'ZZ', plan: 'pro', agree: true, friends: ['di'], pets: [{ id: 7, name: 'ace' }] };

const validate = (values) => {
  const errors = {};
  if (!values.email) errors.email = 'required';
  else if (!/^\S+@\S+$/.test(values.email)) errors.email = 'invalid';
  if (values.code.length < 2) errors.code = 'code too short';
  return errors;
};

export default function Fixture() {
  const [sent, setSent] = useState('');
  const [initial, setInitial] = useState(first);
  const email = useRef(null);
  return (
    <div>
      <button id="f-load" onClick={() => setInitial(loaded)}>load other values</button>
      <Formik
        initialValues={initial}
        enableReinitialize
        validate={validate}
        onSubmit={(values, { setSubmitting }) => { setSent(JSON.stringify(values)); setSubmitting(false); }}
      >
        {({ isSubmitting, values }) => (
          <Form>
            <Field id="f-email" name="email" type="email" innerRef={email} />
            <FocusOnError target={email} />
            <ErrorMessage name="email" render={(msg) => <span id="f-email-error">{msg}</span>} />
            <Upper name="code" />
            <Field id="f-plan" name="plan" as="select">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
            </Field>
            <label><Field id="f-agree" name="agree" type="checkbox" /> agree</label>
            <FieldArray name="friends">
              {(helpers) => (
                <div>
                  {values.friends.map((friend, i) => (
                    <span key={i}>
                      <Field className="f-friend" name={`friends.${i}`} />
                      <button type="button" className="f-remove" onClick={() => helpers.remove(i)}>x</button>
                    </span>
                  ))}
                  <button type="button" id="f-add" onClick={() => helpers.push('')}>add friend</button>
                </div>
              )}
            </FieldArray>
            <FieldArray name="pets">
              {(helpers) => (
                <ul id="f-pets">
                  {values.pets.map((pet, i) => (
                    <li key={pet.id} className="f-pet-row"><Field className="f-pet" name={`pets.${i}.name`} /></li>
                  ))}
                  <button type="button" id="f-swap" onClick={() => helpers.swap(0, 1)}>swap pets</button>
                </ul>
              )}
            </FieldArray>
            <button id="f-submit" type="submit" disabled={isSubmitting}>submit</button>
            <button id="f-reset" type="reset">reset</button>
            <Status />
          </Form>
        )}
      </Formik>
      <pre id="f-sent">{sent}</pre>
    </div>
  );
}
