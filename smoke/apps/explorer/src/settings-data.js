// The settings' shape and defaults, apart from the form code so the smoke
// check can import them in Node.

export const PACKAGE_COUNT = 50;
export const LICENSES = ['MIT', 'Apache-2.0', 'ISC', 'UNLICENSED'];
export const FIELDS_PER_PACKAGE = ['name', 'version', 'license', 'budget', 'owner', 'notes'];
export const TAKEN_SCOPES = ['atlas', 'core', 'ui'];

export function defaultSettings() {
  const values = { scope: 'atlas-labs' };
  for (let i = 0; i < PACKAGE_COUNT; i++) {
    values[`name${i}`] = `pkg-${i}`;
    values[`version${i}`] = `1.${i % 7}.${i % 3}`;
    values[`license${i}`] = LICENSES[i % LICENSES.length];
    values[`budget${i}`] = String(20 + ((i * 37) % 180));
    values[`owner${i}`] = `team${i % 9}@atlas.dev`;
    values[`notes${i}`] = '';
  }
  return values;
}
