import { strictEqual } from "node:assert";

export const unitChecks = [];

export function test(name, run) {
  unitChecks.push({ name, run });
}

export function expect(actual) {
  return { toEqual: (expected) => strictEqual(actual, expected) };
}
