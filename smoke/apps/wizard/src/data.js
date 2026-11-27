// Harbor's reference data and the rules the quote server applies. Plain data
// and functions, shared by the page, the API (api.js) and the smoke check, so
// the check computes every expected answer from the same source.

export const COUNTRIES = [
  { code: 'US', name: 'United States', postal: /^\d{5}(-\d{4})?$/, postalHint: '5 digits' },
  { code: 'CA', name: 'Canada', postal: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/i, postalHint: 'A1A 1A1' },
  { code: 'GB', name: 'United Kingdom', postal: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, postalHint: 'SW1A 1AA' },
  { code: 'AU', name: 'Australia', postal: /^\d{4}$/, postalHint: '4 digits' },
];

export const countryOf = (code) => COUNTRIES.find((c) => c.code === code);

// The United Kingdom has no state list, so its address has no state field.
export const REGIONS = {
  US: ['California', 'Colorado', 'Florida', 'Illinois', 'Maine', 'New York', 'Oregon', 'Texas', 'Vermont', 'Washington'],
  CA: ['Alberta', 'British Columbia', 'Manitoba', 'Nova Scotia', 'Ontario', 'Quebec'],
  AU: ['New South Wales', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'],
};

// How long the server takes to list a country's regions: the United States
// slowest, so a visitor who picks it and then Canada gets Canada's answer
// first and the United States' after it.
export const REGION_DELAY = { US: 450, CA: 40, AU: 160 };

// Addresses already holding a policy. The lookup of one takes far longer
// than the lookup of a free address, so its answer lands after answers for
// what the visitor typed next.
export const TAKEN = ['taken@harbor.test', 'claims@harbor.test'];
export const EMAIL_DELAY = { taken: 600, free: 40 };

// VINs the server refuses, which only the server knows.
export const STOLEN_VINS = ['1HGCM82633A004352'];

export const MAKES = ['Ford', 'Honda', 'Subaru', 'Tesla', 'Toyota', 'Volvo'];
export const USAGES = [
  { value: 'commute', label: 'Commuting' },
  { value: 'pleasure', label: 'Pleasure' },
  { value: 'business', label: 'Business' },
];
export const INCIDENT_KINDS = ['Collision', 'Speeding', 'Theft', 'Weather'];
export const LIMITS = ['50/100', '100/300', '250/500'];
export const DEDUCTIBLES = ['250', '500', '1000'];
export const ADDONS = [
  { name: 'roadside', label: 'Roadside assistance' },
  { name: 'rental', label: 'Rental car' },
  { name: 'glass', label: 'Glass cover' },
];
export const NOTES_MAX = 500;

// The coverage of the policy the visitor holds now, which the Coverage step
// can start from.
export const CURRENT_POLICY = { limit: '250/500', deductible: '1000', roadside: true, rental: false, glass: true };

// The steps, in order. `when` decides whether a step applies to this draft:
// the business step is added only when a vehicle is used for business.
export const STEPS = [
  { id: 'about', label: 'About you' },
  { id: 'address', label: 'Address' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'drivers', label: 'Drivers' },
  { id: 'business', label: 'Business use', when: (d) => d.vehicles.some((v) => v.usage === 'business') },
  { id: 'coverage', label: 'Coverage' },
  { id: 'documents', label: 'Documents' },
  { id: 'review', label: 'Review' },
];

export const stepsFor = (draft) => STEPS.filter((s) => !s.when || s.when(draft));

let seq = 0;
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyVehicle(id) {
  return { id, year: '', make: '', model: '', vin: '', usage: 'commute', miles: '' };
}

export function emptyIncident(id) {
  return { id, date: '', kind: 'Collision', detail: '' };
}

export function emptyDriver(id) {
  return { id, name: '', license: '', since: '', incidents: [] };
}

export function emptyDraft() {
  return {
    about: { firstName: '', lastName: '', email: '', phone: '', birthDate: '' },
    address: { country: 'US', region: '', city: '', postal: '', mailingDiffers: false, mailingStreet: '' },
    vehicles: [emptyVehicle('v0')],
    drivers: [emptyDriver('d0')],
    business: { company: '', ein: '', fleet: '' },
    coverage: { start: '', end: '', limit: '100/300', deductible: '500', roadside: false, rental: false, glass: false },
    documents: { notes: '', licenseName: '' },
    done: {},
  };
}

// What the server says about a submitted quote: errors mapped to the step
// and field they belong to, or the quote.
export function judgeQuote(draft, license) {
  const errors = [];
  for (const v of draft.vehicles) {
    if (STOLEN_VINS.includes(String(v.vin).toUpperCase())) {
      errors.push({ step: 'vehicles', name: `vehicles.${v.id}.vin`, message: 'This VIN is reported stolen' });
    }
  }
  if (!license || license.size === 0) {
    errors.push({ step: 'documents', name: 'license', message: 'Attach a photo of your license' });
  }
  if (errors.length) return { ok: false, errors };
  const base = 480 + draft.vehicles.length * 310 + draft.drivers.reduce((n, d) => n + d.incidents.length * 140, 0);
  return { ok: true, premium: base, licenseName: license.name, licenseBytes: license.size };
}
