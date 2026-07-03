// Invalid What JSX — the types MUST reject this (proves the runtime types are
// not blanket `any`). A string is not a valid onclick handler.
function Bad() {
  return <button onclick={'not a function'}>x</button>;
}

export default Bad;
