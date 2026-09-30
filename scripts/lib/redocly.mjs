// Runs the Redocly CLI from node_modules with the current Node binary, without update checks.
// Telemetry is switched off in redocly.yaml and again here through the environment.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function cliPath() {
  const pkgFile = require.resolve('@redocly/cli/package.json');
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.redocly;
  return path.join(path.dirname(pkgFile), bin);
}

/** Runs `redocly <args>` in `cwd`; returns { status, stdout, stderr }. */
export function runRedocly(args, { cwd, stdio = 'pipe' } = {}) {
  const result = spawnSync(process.execPath, [cliPath(), ...args], {
    cwd,
    stdio,
    encoding: 'utf8',
    env: {
      ...process.env,
      REDOCLY_TELEMETRY: 'off',
      REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true',
      NO_COLOR: '1',
    },
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}
