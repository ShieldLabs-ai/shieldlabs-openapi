#!/usr/bin/env node
// Lints spec/ with Redocly and the strict configuration in redocly.yaml (every problem is an
// error; the only accepted exception is listed in .redocly.lint-ignore.yaml).
import { ROOT } from './lib/fixtures.mjs';
import { runRedocly } from './lib/redocly.mjs';

const { status } = runRedocly(
  ['lint', 'spec/openapi.yaml', '--config', 'redocly.yaml', '--format', 'stylish', ...process.argv.slice(2)],
  { cwd: ROOT, stdio: 'inherit' },
);
process.exitCode = status ?? 1;
