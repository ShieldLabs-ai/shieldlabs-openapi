// Shared test helpers: one fresh build of spec/ per test process, plus small lookups.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildFiles, BUNDLE_JSON } from '../scripts/build.mjs';
import { ROOT } from '../scripts/lib/fixtures.mjs';
import { createValidator } from '../scripts/lib/validator.mjs';

export { ROOT };
export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

let cached;

/** Builds spec/ in memory once and returns { files, doc, validator }. */
export function freshBuild() {
  if (!cached) {
    const files = buildFiles();
    const doc = JSON.parse(files.get(BUNDLE_JSON));
    cached = { files, doc, validator: createValidator(doc) };
  }
  return cached;
}

export function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

/** Resolves a local `$ref` ("#/components/...") inside the bundled document. */
export function deref(doc, node) {
  let current = node;
  for (let depth = 0; current && typeof current.$ref === 'string' && depth < 10; depth += 1) {
    current = current.$ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((obj, key) => obj?.[key], doc);
  }
  return current;
}

/** Every operation in paths and webhooks: { kind, key, method, pathItem, operation }. */
export function operations(doc) {
  const result = [];
  for (const [kind, map] of [['path', doc.paths ?? {}], ['webhook', doc.webhooks ?? {}]]) {
    for (const [key, rawItem] of Object.entries(map)) {
      const pathItem = deref(doc, rawItem);
      for (const method of HTTP_METHODS) {
        if (pathItem[method]) result.push({ kind, key, method, pathItem, operation: pathItem[method] });
      }
    }
  }
  return result;
}

export function operationById(doc, operationId) {
  const found = operations(doc).find((op) => op.operation.operationId === operationId);
  if (!found) throw new Error(`No operation ${operationId}`);
  return found;
}

/** Every media type object of an operation: { where, mediaType, media }. */
export function mediaTypes(doc, operation) {
  const result = [];
  const body = deref(doc, operation.requestBody);
  for (const [mediaType, media] of Object.entries(body?.content ?? {})) {
    result.push({ where: 'requestBody', mediaType, media });
  }
  for (const [status, rawResponse] of Object.entries(operation.responses ?? {})) {
    const response = deref(doc, rawResponse);
    for (const [mediaType, media] of Object.entries(response.content ?? {})) {
      result.push({ where: `response ${status}`, status, mediaType, media });
    }
  }
  return result;
}

/** Named examples of a media type, parameter or header, dereferenced: [name, value]. */
export function namedExamples(doc, holder) {
  const list = Object.entries(holder.examples ?? {}).map(([name, raw]) => [name, deref(doc, raw).value]);
  if ('example' in holder) list.push(['example', holder.example]);
  return list;
}

/** History row fields the spec leaves undocumented on purpose: low-level network diagnostics. */
export const DIAGNOSTIC_HISTORY_FIELDS = [
  'scanner_web_rtc_ip',
  'scanner_web_rtc_country',
  'scanner_web_rtc_connection_type',
  'tcp_mss',
  'mtu_value',
  'mtu_hint',
  'stun_request_seen',
  'is_scanner_stun_passed',
  'stun_flow_status',
];

/** Deprecated Management history fields left undocumented for the same reason. */
export const DIAGNOSTIC_LEGACY_FIELDS = ['TcpMss', 'MtuValue', 'MtuHint'];

/** The only way the analytics dashboard test delivery may deviate from the event schema. */
export const TEST_DELIVERY_MISSING_FLAGS = ['browser_automation', 'search_bot'];

/**
 * Asserts that Ajv errors are exactly the two missing test delivery flags at `flagsPath`.
 * Returns a message describing the mismatch, or null when the errors are as expected.
 */
export function testDeliveryMismatch(errors, flagsPath) {
  const actual = errors
    .map((e) => `${e.instancePath} ${e.keyword} ${e.params?.missingProperty ?? ''}`.trim())
    .sort();
  const expected = TEST_DELIVERY_MISSING_FLAGS.map((flag) => `${flagsPath} required ${flag}`).sort();
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? null
    : `expected only ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
}

/**
 * Keeps the undocumented keys that are not known diagnostic fields. `kind` tells where diagnostic
 * fields may appear: 'history-page' (rows under /data), 'history-row' (top level), 'legacy-list'
 * (deprecated Management rows) or 'none'.
 */
export function unexpectedUndocumented(paths, kind = 'none') {
  const history = DIAGNOSTIC_HISTORY_FIELDS.join('|');
  const legacy = DIAGNOSTIC_LEGACY_FIELDS.join('|');
  const allowed = {
    'history-page': new RegExp(`^/data/\\d+/(${history})$`),
    'history-row': new RegExp(`^/(${history})$`),
    'legacy-list': new RegExp(`^/\\d+/(${legacy})$`),
    none: null,
  }[kind];
  if (allowed === undefined) throw new Error(`Unknown kind ${kind}`);
  return paths.filter((p) => !(allowed && allowed.test(p)));
}

/** Which diagnostic fields a media type schema may carry, for unexpectedUndocumented(). */
export function diagnosticKind(schema) {
  if (schema?.$ref === '#/components/schemas/HistoryPage') return 'history-page';
  if (schema?.$ref === '#/components/schemas/HistoryRow') return 'history-row';
  if (schema?.items?.$ref === '#/components/schemas/LegacySnapshot') return 'legacy-list';
  return 'none';
}
