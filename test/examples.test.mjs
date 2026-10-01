// Every example in the document validates against its schema (Ajv, JSON Schema 2020-12), and the
// fixture-based examples are exact copies of the vendored fixtures.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { EXAMPLES_DIR, FIXTURE_EXAMPLES, fixtureExampleValue } from '../scripts/lib/fixtures.mjs';
import { describeErrors } from '../scripts/lib/validator.mjs';
import { renderExample } from '../scripts/sync-fixtures.mjs';
import {
  deref,
  diagnosticKind,
  freshBuild,
  mediaTypes,
  namedExamples,
  operations,
  testDeliveryMismatch,
  unexpectedUndocumented,
} from './helpers.mjs';

const TEST_DELIVERY_EXAMPLE = 'identificationScored requestBody application/json testDelivery';

function allMediaExamples(doc) {
  const list = [];
  for (const { operation } of operations(doc)) {
    for (const { where, mediaType, media } of mediaTypes(doc, operation)) {
      for (const [name, value] of namedExamples(doc, media)) {
        list.push({ label: `${operation.operationId} ${where} ${mediaType} ${name}`, schema: media.schema, value });
      }
    }
  }
  return list;
}

describe('media type examples', () => {
  it('validate against their schemas (the test delivery fails on its two missing flags only)', () => {
    const { doc, validator } = freshBuild();
    const examples = allMediaExamples(doc);
    assert.ok(examples.length >= 30, `only ${examples.length} examples`);
    let sawTestDelivery = false;
    for (const { label, schema, value } of examples) {
      const result = validator.validate(schema, value);
      if (label === TEST_DELIVERY_EXAMPLE) {
        sawTestDelivery = true;
        assert.equal(result.valid, false, 'the test delivery must not validate');
        assert.equal(testDeliveryMismatch(result.errors, '/data/detection_flags'), null, label);
      } else {
        assert.ok(result.valid, `${label}: ${describeErrors(result.errors)}`);
      }
    }
    assert.ok(sawTestDelivery, 'the test delivery example is missing');
  });

  it('carry JSON that matches the content schema of text fields (score_details, text/plain errors)', () => {
    const { doc, validator } = freshBuild();
    for (const { label, schema, value } of allMediaExamples(doc)) {
      const { contentErrors } = validator.inspect(schema, value);
      assert.deepEqual(contentErrors, [], label);
    }
  });

  it('only carry fields the schemas document (apart from diagnostic network fields)', () => {
    const { doc, validator } = freshBuild();
    for (const { label, schema, value } of allMediaExamples(doc)) {
      const { undocumented } = validator.inspect(schema, value);
      assert.deepEqual(unexpectedUndocumented(undocumented, diagnosticKind(schema)), [], label);
    }
  });
});

describe('parameter and header examples', () => {
  it('validate against their schemas', () => {
    const { doc, validator } = freshBuild();
    let count = 0;
    const check = (label, holder) => {
      for (const [name, value] of namedExamples(doc, holder)) {
        count += 1;
        const result = validator.validate(holder.schema, value);
        assert.ok(result.valid, `${label} ${name}: ${describeErrors(result.errors)}`);
      }
    };
    for (const [name, parameter] of Object.entries(doc.components.parameters)) check(`parameter ${name}`, parameter);
    for (const [name, header] of Object.entries(doc.components.headers)) check(`header ${name}`, header);
    assert.ok(count >= 15, `only ${count} parameter and header examples`);
  });
});

describe('schema examples', () => {
  it('validate against the schema they belong to', () => {
    const { doc, validator } = freshBuild();
    let count = 0;
    const visit = (label, schema) => {
      if (!schema || typeof schema !== 'object') return;
      if (Array.isArray(schema.examples)) {
        for (const value of schema.examples) {
          count += 1;
          const result = validator.validate(schema, value);
          assert.ok(result.valid, `${label} example ${JSON.stringify(value)}: ${describeErrors(result.errors)}`);
        }
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) visit(`${label}.${key}`, child);
      if (schema.items) visit(`${label}[]`, schema.items);
      if (schema.contentSchema) visit(`${label}<json>`, schema.contentSchema);
    };
    for (const [name, schema] of Object.entries(doc.components.schemas)) visit(name, schema);
    assert.ok(count >= 60, `only ${count} schema examples`);
  });
});

describe('fixture-based examples', () => {
  it('equal the vendored fixtures they are generated from', () => {
    const { doc } = freshBuild();
    for (const entry of FIXTURE_EXAMPLES) {
      const example = doc.components.examples[entry.name];
      assert.ok(example, `${entry.name} is not used in the document`);
      assert.deepEqual(example.value, fixtureExampleValue(entry), entry.name);
    }
  });

  it('are up to date on disk (run `npm run sync:fixtures` after changing fixtures)', () => {
    for (const entry of FIXTURE_EXAMPLES) {
      const file = path.join(EXAMPLES_DIR, `${entry.name}.yaml`);
      assert.equal(readFileSync(file, 'utf8'), renderExample(entry, fixtureExampleValue(entry)), entry.name);
    }
    const generated = readdirSync(EXAMPLES_DIR).filter((name) =>
      readFileSync(path.join(EXAMPLES_DIR, name), 'utf8').startsWith('# Generated'),
    );
    assert.deepEqual(generated.sort(), FIXTURE_EXAMPLES.map((e) => `${e.name}.yaml`).sort());
  });

  it('include the rate-limit marker and the test delivery variants', () => {
    const { doc } = freshBuild();
    const body = deref(doc, doc.webhooks['identification.scored']).post.requestBody.content['application/json'];
    const names = Object.values(body.examples).map((e) => e.$ref);
    assert.ok(names.includes('#/components/examples/IdentificationScoredRateLimited'));
    assert.ok(names.includes('#/components/examples/IdentificationScoredTestDelivery'));
  });
});
