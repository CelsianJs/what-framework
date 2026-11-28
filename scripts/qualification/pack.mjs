import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../../', import.meta.url));

export function packPackages(tarDir, names) {
  return Object.fromEntries(names.map(name => {
    const output = execFileSync('npm', [
      'pack', resolve(repo, 'packages', name), '--pack-destination', tarDir, '--ignore-scripts', '--silent',
    ], { encoding: 'utf8', timeout: 30000 });
    return [name === 'what' ? 'what-framework' : 'what-' + name, 'file:' + join(tarDir, output.trim())];
  }));
}

export function installPacked(app) {
  execFileSync('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
    cwd: app, encoding: 'utf8', timeout: 30000,
  });
}
