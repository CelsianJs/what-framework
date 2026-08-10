// The narrative content. Pure data, no framework imports, so the server and the
// browser read the same copy without either one pulling in the other's runtime.
//
// Northline 01 is a fictional product. Every figure below is invented for the
// demo, which is why the page prints them as product claims and never as facts
// about the world.

export const chapters = [
  { id: 'open', num: '00', title: 'Northline 01' },
  { id: 'origin', num: '01', title: 'Where it starts' },
  { id: 'light', num: '02', title: 'What it puts out' },
  { id: 'materials', num: '03', title: 'What it is made of' },
  { id: 'compare', num: '04', title: 'What it replaces' },
  { id: 'notes', num: '05', title: 'Colophon' },
];

/** The counter in chapter 01 tweens up to this. */
export const BURN_IN_HOURS = 4200;

/** The meter in chapter 02 springs up to this. */
export const RATED_LUMENS = 1240;

export const colorways = [
  { id: 'brass', label: 'Brass', tint: '#c8912f' },
  { id: 'graphite', label: 'Graphite', tint: '#7b8794' },
  { id: 'oxblood', label: 'Oxblood', tint: '#9c3b3b' },
];

export const specGroups = [
  { id: 'all', label: 'Everything' },
  { id: 'optics', label: 'Optics' },
  { id: 'body', label: 'Body' },
  { id: 'power', label: 'Power' },
];

export const specs = [
  { group: 'optics', label: 'Rated output', value: '1,240 lm' },
  { group: 'optics', label: 'Colour temperature', value: '2700K' },
  { group: 'optics', label: 'Colour rendering', value: 'CRI 97' },
  { group: 'optics', label: 'Beam angle', value: '38 degrees' },
  { group: 'body', label: 'Shade', value: 'Spun aluminium, 1.2 mm' },
  { group: 'body', label: 'Arm', value: 'Cold-drawn steel' },
  { group: 'body', label: 'Reach', value: '620 mm' },
  { group: 'body', label: 'Mass', value: '2.4 kg' },
  { group: 'power', label: 'Draw at full', value: '11 W' },
  { group: 'power', label: 'Standby', value: '0.2 W' },
  { group: 'power', label: 'Cable', value: '2.1 m, braided' },
];

/** Chapter 04's comparison, wiped between by the wide-viewport island. */
export const comparison = {
  left: {
    name: 'The 60 W bulb it replaces',
    rows: [
      { label: 'Draw', value: '60 W', fill: 100 },
      { label: 'Output', value: '810 lm', fill: 65 },
      { label: 'Heat at the shade', value: '92 C', fill: 96 },
      { label: 'Rated life', value: '1,000 h', fill: 24 },
    ],
  },
  right: {
    name: 'Northline 01',
    rows: [
      { label: 'Draw', value: '11 W', fill: 18 },
      { label: 'Output', value: '1,240 lm', fill: 100 },
      { label: 'Heat at the shade', value: '41 C', fill: 43 },
      { label: 'Rated life', value: '25,000 h', fill: 100 },
    ],
  },
};

export const productionNotes = [
  'Every shade is spun on a 1962 Herbert lathe, then annealed twice.',
  'The arm is cut oversize and ground back, so the pivot never sees a weld.',
  'Units that fail burn-in are stripped for parts, never reworked.',
];
