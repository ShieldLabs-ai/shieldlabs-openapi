import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import YAML from 'yaml';
import { freshBuild, ROOT } from './helpers.mjs';

it('webhook client identity and every nested field accept missing and null values', () => {
  const { doc, validator } = freshBuild();
  const eventSchema = doc.components.schemas.IdentificationScoredEvent;
  const fixture = JSON.parse(readFileSync(path.join(ROOT, 'test/contracts/named.json'), 'utf8'));
  const check = identity => {
    const event = structuredClone(fixture);
    if (identity !== undefined) event.data.client_identity = identity;
    const result = validator.validate(eventSchema, event);
    assert.ok(result.valid, JSON.stringify(result.errors));
  };
  check(undefined);
  check(null);
  check({});
  const identitySchema = YAML.parse(readFileSync(path.join(ROOT, 'spec/components/schemas/WebhookClientIdentity.yaml'), 'utf8'));
  function allNulls(schema) {
    assert.equal(schema.required, undefined);
    assert.ok(schema.type.includes('null'));
    for (const child of Object.values(schema.properties ?? {})) allNulls(child);
    if (schema.items) allNulls(schema.items);
    return Object.fromEntries(Object.keys(schema.properties ?? {}).map(key => [key, null]));
  }
  check(allNulls(identitySchema));
  for (const key of ['claims', 'verified', 'assessments', 'evidence']) {
    check({ [key]: [null, {}, allNulls(identitySchema.properties[key].items)] });
  }
  const invalid = structuredClone(fixture);
  invalid.data.client_identity = { classification_revision: 'invalid' };
  assert.equal(validator.validate(eventSchema, invalid).valid, false);
});
