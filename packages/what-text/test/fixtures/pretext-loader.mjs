// The documented asynchronous ESM loader works on Node 20 and newer. Each
// probe has its own process, so neither failure caching nor hooks leak to tests.
const mode = process.env.WHAT_PRETEXT_FIXTURE;
let attempts = 0;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@chenglou/pretext') {
    attempts++;
    if (mode === 'missing' || (mode === 'retry' && attempts === 1)) {
      throw Object.assign(new Error('Cannot find package @chenglou/pretext (isolated fixture)'), {
        code: 'ERR_MODULE_NOT_FOUND',
      });
    }
    if (mode === 'broken') {
      return {
        url: 'data:text/javascript,throw new Error("installed Pretext initialization failed")',
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}
