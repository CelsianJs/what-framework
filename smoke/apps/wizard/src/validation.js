// Each step's validation, as useForm resolvers. Three kinds, the way a real
// app mixes them: a schema (zod) with an async availability check composed on
// top (About), rule maps (Address, Business), schemas over nested arrays of
// items (Vehicles, Drivers, whose items each hold incidents), and a schema
// with a cross-field rule (Coverage).
//
// A resolver is told which fields to judge in `options.names` (a field's own
// validation); a whole-step validation passes none and judges every field.
// A schema judges every field either way, and the form shows a field's own
// validation on that field alone.

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

// --- Arrays: schemas over the items, nested -----------------------------------
// The form's values are nested by the fields' names (`vehicles.0.vin` is
// values.vehicles[0].vin), so a schema describes the arrays as they are, and
// an issue's path is the name of the field it belongs to.

const between = (min, max, message) => (v) => (Number(v) >= min && Number(v) <= max ? undefined : message);
const judged = (check) => z.string().superRefine((v, ctx) => {
  const message = check(v);
  if (message) ctx.addIssue({ code: 'custom', message });
});

const vehicleSchema = z.object({
  year: z.string().min(1, 'Enter the year').superRefine((v, ctx) => {
    const message = v && between(1981, 2027, 'A year from 1981 to 2027')(v);
    if (message) ctx.addIssue({ code: 'custom', message });
  }),
  make: z.string().min(1, 'Choose a make'),
  model: z.string().trim().min(1, 'Enter the model'),
  vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i, 'A VIN is 17 letters and digits, without I, O or Q'),
  usage: z.string().min(1, 'Choose how it is used'),
  miles: z.string().min(1, 'Enter the miles a year').superRefine((v, ctx) => {
    const message = v && between(0, 99999, 'Up to 99,999 miles')(v);
    if (message) ctx.addIssue({ code: 'custom', message });
  }),
});
export const vehiclesResolver = zodResolver(z.object({ vehicles: z.array(vehicleSchema).min(1, 'Add a vehicle') }));

const incidentSchema = z.object({
  date: judged((v) => (!v ? 'Enter the date' : v > today() ? 'That date is in the future' : undefined)),
  kind: z.string().min(1, 'Choose a kind'),
  detail: z.string().max(200, 'At most 200 characters'),
});

const driverSchema = z.object({
  name: z.string().trim().min(1, 'Enter the driver\'s name'),
  license: z.string().regex(/^[A-Z0-9]{6,12}$/i, '6 to 12 letters and digits'),
  since: judged((v) => {
    if (!v) return 'Enter the date licensed';
    if (v > today()) return 'That date is in the future';
    const born = draft.peek().about.birthDate;
    if (born && yearsBetween(born, v) < 16) return 'Licensed before turning 16?';
    return undefined;
  }),
  incidents: z.array(incidentSchema),
}).superRefine((d, ctx) => {
  // An incident before the driver was licensed: a rule across the item.
  d.incidents.forEach((incident, i) => {
    if (d.since && incident.date && incident.date <= today() && incident.date < d.since) {
      ctx.addIssue({ code: 'custom', path: ['incidents', i, 'date'], message: 'Before this driver was licensed' });
    }
  });
});
export const driversResolver = zodResolver(z.object({ drivers: z.array(driverSchema).min(1, 'Add a driver') }));

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
