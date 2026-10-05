import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ROOT } from '../scripts/lib/fixtures.mjs';
import { exportSchema } from '../scripts/lib/json-schema.mjs';
import { createAjv } from '../scripts/lib/validator.mjs';

it('accepts scoped ingest identity and future values without requiring a global verified flag', () => {
  const validate = createAjv().compile(exportSchema(ROOT, { source: 'spec/components/schemas/ClientIdentity.yaml', file: 'client-identity.schema.json' }));
  const identity = {
    schema_version: '1', classification_revision: 1, classifier_version: '192.1', registry_revision: '2026-10-06.1', availability: 'available', observed_at: '2026-10-06T12:00:00Z', decided_at: '2026-10-06T12:00:00Z',
    claims: [{ profile_id: 'gptbot', provider_id: 'openai', provider_name: 'OpenAI', agent_name: 'GPTBot', client_kind: 'crawler', purpose: 'training', source: 'http_ua' }],
    verified: [{ subject: 'provider', value_id: 'openai', evidence_ids: ['ip:1'] }],
    assessments: [{ status: 'unverified', reason: 'ua_only' }],
    evidence: [{ id: 'ip:1', method: 'published_ip', source_id: 'https://openai.com/gptbot.json', source_revision: 'sha256:fixture', checked_at: '2026-10-06T12:00:00Z', evaluated_at: '2026-10-06T12:00:00Z', covered_attributes: ['provider'] }],
  };
  assert.equal(validate(identity), true, JSON.stringify(validate.errors));
  identity.verified[0].subject = 'future_subject';
  identity.evidence[0].method = 'future_method';
  identity.future_attribute = 'accepted';
  assert.equal(validate(identity), true, JSON.stringify(validate.errors));
});
