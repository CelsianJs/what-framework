// Check metadata separately from install resolution: a working exact version
// does not prove the requested dist-tag was moved, and vice versa.
export function verifyRegistryCohort({ packages, version, tag, run }) {
  for (const name of packages) {
    const spec = `${name}@${version}`;
    const exact = JSON.parse(run(['view', spec, 'version', '--json']).stdout);
    if (exact !== version) throw new Error(`${spec}: registry returned ${JSON.stringify(exact)}, expected ${version}`);
    const tags = JSON.parse(run(['view', name, 'dist-tags', '--json']).stdout);
    if (tags[tag] !== version) {
      throw new Error(`${name}: dist-tag ${tag} points to ${tags[tag] ?? '(missing)'}, expected ${version}`);
    }
  }
}
