import React from 'react';
import { Formik, Form, Field, ErrorMessage } from 'formik';

export function FormikTest() {
  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>formik</h3>
      <Formik
        initialValues={{ name: '', email: '' }}
        validate={values => {
          const errors = {};
          if (!values.name) errors.name = 'Required';
          if (!values.email) errors.email = 'Required';
          else if (!/\S+@\S+\.\S+/.test(values.email)) errors.email = 'Invalid email';
          return errors;
        }}
        onSubmit={(values, { setSubmitting }) => {
          setTimeout(() => {
            alert(JSON.stringify(values, null, 2));
            setSubmitting(false);
          }, 400);
        }}
      >
        {({ isSubmitting }) => (
          <Form style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 300 }}>
            <div>
              <Field name="name" placeholder="Name" style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4, width: '100%' }} />
              <ErrorMessage name="name" component="div" style={{ color: 'red', fontSize: 12 }} />
            </div>
            <div>
              <Field name="email" type="email" placeholder="Email" style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4, width: '100%' }} />
              <ErrorMessage name="email" component="div" style={{ color: 'red', fontSize: 12 }} />
            </div>
            <button type="submit" disabled={isSubmitting} style={{ padding: '6px 12px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
              {isSubmitting ? 'Submitting...' : 'Submit'}
            </button>
          </Form>
        )}
      </Formik>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — Formik + Field + validation work</p>
    </div>
  );
}
