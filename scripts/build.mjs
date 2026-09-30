#!/usr/bin/env node
// Builds dist/ from spec/:
//   dist/shieldlabs-api.yaml    Redocly bundle of spec/openapi.yaml
//   dist/shieldlabs-api.json    the same document as JSON
//   dist/schemas/*.schema.json  self-contained JSON Schema 2020-12 exports
//
// Usage: node scripts/build.mjs [outDir]   (default: dist)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { isMain } from './lib/cli.mjs';
import { ROOT } from './lib/fixtures.mjs';
import { exportSchema, SCHEMA_EXPORTS } from './lib/json-schema.mjs';
import { runRedocly } from './lib/redocly.mjs';

export const BUNDLE_YAML = 'shieldlabs-api.yaml';
export const BUNDLE_JSON = 'shieldlabs-api.json';

const toJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

/** Produces every dist file in memory: Map<relative path, content>. */
export function buildFiles() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'shieldlabs-openapi-'));
  try {
    const bundleFile = path.join(tmp, BUNDLE_YAML);
    const result = runRedocly(
      ['bundle', 'spec/openapi.yaml', '--config', 'redocly.yaml', '--output', bundleFile],
      { cwd: ROOT },
    );
    if (result.status !== 0) {
      throw new Error(`redocly bundle failed:\n${result.stdout}${result.stderr}`);
    }
    const yamlText = readFileSync(bundleFile, 'utf8');
    const files = new Map([
      [BUNDLE_YAML, yamlText],
      [BUNDLE_JSON, toJson(YAML.parse(yamlText))],
    ]);
    for (const entry of SCHEMA_EXPORTS) {
      files.set(`schemas/${entry.file}`, toJson(exportSchema(ROOT, entry)));
    }
    return files;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Writes a fresh build into outDir, replacing the previous generated files. */
export function build(outDir = path.join(ROOT, 'dist')) {
  const files = buildFiles();
  rmSync(path.join(outDir, 'schemas'), { recursive: true, force: true });
  for (const [relative, content] of files) {
    const target = path.join(outDir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return [...files.keys()];
}

if (isMain(import.meta.url)) {
  const outDir = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist'));
  const written = build(outDir);
  console.log(`Wrote ${written.length} files to ${path.relative(process.cwd(), outDir) || '.'}:`);
  for (const file of written) console.log(`  ${file}`);
}
