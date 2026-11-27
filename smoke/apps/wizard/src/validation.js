// Each step's validation, as useForm resolvers. Three kinds, the way a real
// app mixes them: a schema (zod) with an async availability check composed on
// top (About), rule maps (Address, Business), rules per array item, nested
// (Vehicles, Drivers), and a schema with a cross-field rule (Coverage).
//
// A resolver is told which fields to judge in `options.names` (a field's own
// validation); a whole-step validation passes none and judges every field.

import { z } from 'zod';
import { rules, simpleResolver, zodResolver } from 'what-framework/form';

import { NOTES_MAX, REGIONS, countryOf } from './data.js';
import { draft } from './draft.js';

const err = (message) => ({ type: 'validation', message });
const today = () => new Date().toISOString().slice(0, 10);
const yearsBetween = (from, to) => {
  const a = new Date(from);
  const b = new Date(to);
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) years--;
  return years;
};

// --- About you: a schema, then the server's availability check ------------

const aboutSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name'),
  lastName: z.string().trim().min(1, 'Enter your last name'),
  email: z.string().trim().min(1, 'Enter your email').pipe(z.email('Enter a valid email')),
  phone: z.string().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number'),
  birthDate: z.string().min(1, 'Enter your date of birth')
    .refine((d) => d < today(), 'That date is in the future')
    .refine((d) => yearsBetween(d, today()) >= 16, 'Drivers must be 16 or older'),
});
const aboutZod = zodResolver(aboutSchema);

export const emailLookups = { started: 0, landed: 0 };

async function emailAvailable(address) {
  emailLookups.started++;
  try {
    const res = await fetch(`/api/email?address=${encodeURIComponent(address)}`);
    return (await res.json()).available;
  } finally {
    emailLookups.landed++;
  }
}

export async function aboutResolver(values, context, options) {
  const result = await aboutZod(values, context, options);
  const names = options?.names;
  if (!result.errors.email && (!names || names.includes('email'))) {
    if (!(await emailAvailable(values.email.trim().toLowerCase()))) {
      result.errors.email = err('This email already has a Harbor policy. Sign in instead.');
    }
  }
  return result;
}

// --- Address: rules that read other fields ----------------------------------

export const addressResolver = simpleResolver({
  country: [rules.required('Choose a country')],
  region: [rules.custom((v, all) => (REGIONS[all.country] && !v ? 'Choose a state or province' : undefined))],
  city: [rules.required('Enter your city')],
  postal: [
    rules.required('Enter your postal code'),
    rules.custom((v, all) => {
      const c = countryOf(all.country);
      return c && !c.postal.test(String(v).trim()) ? `Use the format ${c.postalHint}` : undefined;
    }),
  ],
  mailingStreet: [rules.custom((v, all) => (all.mailingDiffers && !String(v).trim() ? 'Enter your mailing street' : undefined))],
});

// --- Arrays: per-item rules over `prefix.<id>.<field>` names --------------

export const VEHICLE_FIELDS = ['year', 'make', 'model', 'vin', 'usage', 'miles'];
export const vehicleRules = {
  year: (v) => (v === '' ? 'Enter the year' : (Number(v) < 1981 || Number(v) > 2027 ? 'A year from 1981 to 2027' : undefined)),
  make: (v) => (!v ? 'Choose a make' : undefined),
  model: (v) => (!String(v).trim() ? 'Enter the model' : undefined),
  vin: (v) => (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(String(v)) ? 'A VIN is 17 letters and digits, without I, O or Q' : undefined),
  usage: (v) => (!v ? 'Choose how it is used' : undefined),
  miles: (v) => (v === '' ? 'Enter the miles a year' : (Number(v) < 0 || Number(v) > 99999 ? 'Up to 99,999 miles' : undefined)),
};

export const DRIVER_FIELDS = ['name', 'license', 'since'];
export const INCIDENT_FIELDS = ['date', 'kind', 'detail'];
export const driverRules = {
  name: (v) => (!String(v).trim() ? 'Enter the driver\'s name' : undefined),
  license: (v) => (!/^[A-Z0-9]{6,12}$/i.test(String(v)) ? '6 to 12 letters and digits' : undefined),
  since: (v) => {
    if (!v) return 'Enter the date licensed';
    if (v > today()) return 'That date is in the future';
    const born = draft.peek().about.birthDate;
    if (born && yearsBetween(born, v) < 16) return 'Licensed before turning 16?';
    return undefined;
  },
};
export const incidentRules = {
  date: (v, values, driver) => {
    if (!v) return 'Enter the date';
    if (v > today()) return 'That date is in the future';
    const since = values[`drivers.${driver}.since`];
    if (since && v < since) return 'Before this driver was licensed';
    return undefined;
  },
  kind: (v) => (!v ? 'Choose a kind' : undefined),
  detail: (v) => (String(v).length > 200 ? 'At most 200 characters' : undefined),
};

// The live items' field names, for a whole-step validation. Fields of
// removed items stay in the form's values; only the live ones are judged.
function judge(names, values, ruleFor, rootErrors) {
  const errors = { ...rootErrors };
  for (const name of names) {
    const message = ruleFor(name, values);
    if (message) errors[name] = err(message);
  }
  return { values, errors };
}

export function vehiclesResolver(liveIds) {
  return async (values, _context, options) => {
    const ids = liveIds();
    const names = options?.names ?? ids.flatMap((id) => VEHICLE_FIELDS.map((f) => `vehicles.${id}.${f}`));
    const root = !options?.names && ids.length === 0 ? { vehicles: err('Add a vehicle') } : {};
    return judge(names, values, (name, all) => vehicleRules[name.split('.')[2]]?.(all[name], all), root);
  };
}

export function driversResolver(liveDrivers) {
  return async (values, _context, options) => {
    const drivers = liveDrivers();
    const names = options?.names ?? drivers.flatMap(({ id, incidents }) => [
      ...DRIVER_FIELDS.map((f) => `drivers.${id}.${f}`),
      ...incidents.flatMap((i) => INCIDENT_FIELDS.map((f) => `drivers.${id}.incidents.${i}.${f}`)),
    ]);
    const root = !options?.names && drivers.length === 0 ? { drivers: err('Add a driver') } : {};
    return judge(names, values, (name, all) => {
      const parts = name.split('.');
      if (parts[2] === 'incidents') return incidentRules[parts[4]]?.(all[name], all, parts[1]);
      return driverRules[parts[2]]?.(all[name], all);
    }, root);
  };
}

// --- Business, Coverage, Documents ------------------------------------------

export const businessResolver = simpleResolver({
  company: [rules.required('Enter the company name')],
  ein: [rules.required('Enter the EIN'), rules.pattern(/^\d{2}-\d{7}$/, 'An EIN looks like 12-3456789')],
  fleet: [rules.required('Enter the fleet size'), rules.min(1, 'At least 1 vehicle'), rules.max(500, 'Up to 500 vehicles')],
});

const coverageSchema = z.object({
  start: z.string().min(1, 'Choose a start date').refine((d) => d >= today(), 'Coverage cannot start in the past'),
  end: z.string().min(1, 'Choose an end date'),
  limit: z.string().min(1, 'Choose a liability limit'),
  deductible: z.string().min(1, 'Choose a deductible'),
}).superRefine((v, ctx) => {
  if (!v.start || !v.end) return;
  if (v.end <= v.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'The end date must be after the start date' });
  else if ((new Date(v.end) - new Date(v.start)) / 86400000 > 366) ctx.addIssue({ code: 'custom', path: ['end'], message: 'A policy lasts at most a year' });
});
export const coverageResolver = zodResolver(coverageSchema);

export const LICENSE_MAX_BYTES = 2_000_000;

export const documentsResolver = simpleResolver({
  license: [rules.custom((files) => {
    const file = files && files.length ? files[0] : null;
    if (!file) return 'Attach a photo of your license';
    if (!(file instanceof File)) return 'That is not a file';
    if (file.size > LICENSE_MAX_BYTES) return 'Choose a file under 2 MB';
    return undefined;
  })],
  notes: [rules.maxLength(NOTES_MAX, `At most ${NOTES_MAX} characters`)],
});
