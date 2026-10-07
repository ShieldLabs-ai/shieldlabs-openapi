// Turns split OpenAPI schema sources into self-contained JSON Schema 2020-12 documents, and gives
// the tests the same schema walker to compile OpenAPI component schemas with Ajv.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';
export const SCHEMA_ID_BASE = 'https://cdn.jsdelivr.net/npm/@shieldlabs-ai/openapi@1/dist/schemas/';

/** JSON Schema exports written to dist/schemas/ (source paths are relative to the repo root). */
export const SCHEMA_EXPORTS = [
  { file: 'multiaccount-changed-event.schema.json', source: 'spec/components/schemas/MultiaccountChangedEvent.yaml', title: 'ShieldLabs multi-account group webhook event' },
  { file: 'identification-scored-event.schema.json', source: 'spec/components/schemas/IdentificationScoredEvent.yaml', title: 'ShieldLabs identification.scored webhook event' },
  { file: 'webhook-ping-event.schema.json', source: 'spec/components/schemas/WebhookPingEvent.yaml', title: 'ShieldLabs webhook.ping event' },
  { file: 'webhook-event.schema.json', source: 'spec/models/WebhookEvent.yaml' },
  { file: 'history-row.schema.json', source: 'spec/components/schemas/HistoryRow.yaml', title: 'ShieldLabs History API row' },
  { file: 'history-page.schema.json', source: 'spec/components/schemas/HistoryPage.yaml', title: 'ShieldLabs History API page' },
  { file: 'identification.schema.json', source: 'spec/models/Identification.yaml' },
];

// Keywords whose value is one subschema, a list of subschemas, or a map of subschemas.
const SCHEMA_VALUED = new Set([
  'items', 'additionalProperties', 'not', 'contentSchema', 'propertyNames', 'if', 'then', 'else',
  'unevaluatedItems', 'unevaluatedProperties', 'contains',
]);
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas']);
// OpenAPI-only keywords that are not JSON Schema.
const OAS_ONLY = new Set(['example', 'discriminator', 'xml', 'externalDocs']);

/**
 * Copies a schema, dropping `x-` extensions and OpenAPI-only keywords, and passing every `$ref`
 * through `mapRef(ref)`. Values of data keywords (`enum`, `const`, `examples`, `default`) are
 * copied untouched.
 */
export function mapSchema(schema, mapRef) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key.startsWith('x-') || OAS_ONLY.has(key)) continue;
    if (key === '$ref' && typeof value === 'string') out.$ref = mapRef(value);
    else if (SCHEMA_VALUED.has(key)) out[key] = mapSchema(value, mapRef);
    else if (SCHEMA_LISTS.has(key)) out[key] = value.map((item) => mapSchema(item, mapRef));
    else if (SCHEMA_MAPS.has(key)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapSchema(v, mapRef)]));
    } else out[key] = structuredClone(value);
  }
  return out;
}

function loadYaml(file) {
  return YAML.parse(readFileSync(file, 'utf8'));
}

/**
 * Resolves `sourceFile` and every schema file it references into one JSON Schema document.
 * A file reference becomes `#/$defs/<file name without extension>`.
 */
export function exportSchema(root, { source, file, title }) {
  const entry = path.resolve(root, source);
  const defs = new Map();
  const origins = new Map();

  function resolveFileRef(ref, baseDir) {
    if (ref.startsWith('#')) return ref;
    if (ref.includes('#')) throw new Error(`Unsupported $ref with a fragment: ${ref}`);
    const target = path.resolve(baseDir, ref);
    if (target === entry) return '#';
    const name = path.basename(target).replace(/\.(ya?ml|json)$/, '');
    const known = origins.get(name);
    if (known && known !== target) throw new Error(`Schema name clash for ${name}: ${known} and ${target}`);
    if (!known) {
      origins.set(name, target);
      defs.set(name, null);
      const dir = path.dirname(target);
      defs.set(name, mapSchema(loadYaml(target), (r) => resolveFileRef(r, dir)));
    }
    return `#/$defs/${name}`;
  }

  const body = mapSchema(loadYaml(entry), (r) => resolveFileRef(r, path.dirname(entry)));
  const { title: sourceTitle, ...rest } = body;
  const result = {
    $schema: JSON_SCHEMA_DIALECT,
    $id: `${SCHEMA_ID_BASE}${file}`,
    title: title ?? sourceTitle,
    ...rest,
  };
  if (defs.size > 0) {
    result.$defs = Object.fromEntries([...defs.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
  return result;
}
