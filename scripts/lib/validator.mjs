// Ajv (JSON Schema 2020-12) validation against the schemas of the bundled OpenAPI document.
// Used by the tests and by scripts/check-live.mjs.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { mapSchema } from './json-schema.mjs';

const COMPONENTS_ID = 'urn:shieldlabs:openapi:components';
const COMPONENT_PREFIX = '#/components/schemas/';

/** A strict Ajv 2020 instance with the formats OpenAPI documents use. */
export function createAjv() {
  const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
  addFormats(ajv);
  return ajv;
}

function toAjvRef(ref) {
  if (ref.startsWith(COMPONENT_PREFIX)) {
    return `${COMPONENTS_ID}#/$defs/${ref.slice(COMPONENT_PREFIX.length)}`;
  }
  throw new Error(`Unexpected $ref in the bundled document: ${ref}`);
}

/** Formats Ajv errors as short, readable lines. */
export function describeErrors(errors) {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ');
}

/**
 * Wraps one bundled OpenAPI document (plain object, as in dist/shieldlabs-api.json).
 * `validate(schema, value)` accepts any schema from the document (for example a media type schema
 * that is only a `$ref`) and returns `{ valid, errors }`.
 */
export function createValidator(doc) {
  const ajv = createAjv();
  const defs = Object.fromEntries(
    Object.entries(doc.components?.schemas ?? {}).map(([name, schema]) => [name, mapSchema(schema, toAjvRef)]),
  );
  ajv.addSchema({ $id: COMPONENTS_ID, $defs: defs });
  const cache = new Map();

  function compile(schema) {
    const key = JSON.stringify(schema);
    if (!cache.has(key)) cache.set(key, ajv.compile(mapSchema(schema, toAjvRef)));
    return cache.get(key);
  }

  /** Follows `$ref`s to component schemas until a schema without `$ref` (or with siblings) remains. */
  function resolve(schema) {
    let current = schema;
    for (let depth = 0; current && typeof current.$ref === 'string' && depth < 10; depth += 1) {
      const name = current.$ref.slice(COMPONENT_PREFIX.length);
      const { $ref, ...siblings } = current;
      const target = doc.components.schemas[name];
      if (!target) throw new Error(`Unknown schema ${current.$ref}`);
      current = { ...target, ...siblings };
    }
    return current;
  }

  function validate(schema, value) {
    const fn = compile(schema);
    const valid = fn(value);
    return { valid, errors: valid ? [] : [...fn.errors] };
  }

  /**
   * Walks `value` along `schema` and reports problems the JSON Schema keywords leave open:
   * - strings with `contentMediaType: application/json` and a `contentSchema` must parse and match
   *   it (an empty string is allowed: the History API sends it when there are no details);
   * - object keys that the schema does not document (collected, not treated as errors).
   */
  function inspect(schema, value, path = '') {
    const report = { contentErrors: [], undocumented: [] };
    walk(schema, value, path, report);
    return report;
  }

  function flatten(schema) {
    const s = resolve(schema);
    if (!s || typeof s !== 'object') return [];
    return [s, ...(s.allOf ?? []).flatMap(flatten)];
  }

  function walk(schema, value, path, report) {
    const parts = flatten(schema);
    const content = parts.find((p) => p.contentMediaType === 'application/json' && p.contentSchema);
    if (typeof value === 'string' && content) {
      if (value.trim() === '') return;
      let parsed;
      try {
        parsed = JSON.parse(value);
      } catch (error) {
        report.contentErrors.push(`${path || '/'} is not JSON: ${error.message}`);
        return;
      }
      const result = validate(content.contentSchema, parsed);
      if (!result.valid) report.contentErrors.push(`${path || '/'} content: ${describeErrors(result.errors)}`);
      walk(content.contentSchema, parsed, `${path}<json>`, report);
      return;
    }
    if (Array.isArray(value)) {
      const items = parts.find((p) => p.items)?.items;
      if (items) value.forEach((item, index) => walk(items, item, `${path}/${index}`, report));
      return;
    }
    if (value && typeof value === 'object' && parts.some((p) => p.properties)) {
      const properties = Object.assign({}, ...parts.map((p) => p.properties ?? {}));
      for (const [key, child] of Object.entries(value)) {
        if (properties[key]) walk(properties[key], child, `${path}/${key}`, report);
        else report.undocumented.push(`${path}/${key}`);
      }
    }
  }

  return { ajv, compile, resolve, validate, inspect };
}
