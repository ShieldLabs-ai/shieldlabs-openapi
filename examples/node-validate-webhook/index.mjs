#!/usr/bin/env node
// Verifies the signature of one webhook delivery, then validates it with the published JSON Schema.
//
//   SHIELDLABS_WEBHOOK_SECRET=whsec_your_signing_secret \
//     node examples/node-validate-webhook/index.mjs <raw-body-file> <X-Shield-Signature value>
//
// SHIELDLABS_WEBHOOK_SECRET may hold several secrets separated by commas (during a rotation).
// Without arguments the script checks the sample delivery stored in this repository, which is
// signed with the test secret whsec_00112233445566778899aabbccddeeff.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '@shieldlabs/openapi/schemas/webhook-event.schema.json' with { type: 'json' };

const SAMPLE = {
  body: fileURLToPath(new URL('../../test/fixtures/webhook-identification-scored.raw.txt', import.meta.url)),
  header: 'sha256=c4d44b7873625bdfda98cdb7a02d460f8492ca6a68fad8d147a5f30ad16f92a9',
  secret: 'whsec_00112233445566778899aabbccddeeff',
};

/** HMAC-SHA256 over the raw bytes, key = the whole secret string (whsec_ included). */
function verifySignature(rawBody, header, secrets) {
  const match = String(header ?? '').trim().match(/^sha256=([0-9a-fA-F]{64})$/);
  if (!match) return false;
  const received = Buffer.from(match[1].toLowerCase(), 'hex');
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac('sha256', Buffer.from(secret, 'utf8')).update(rawBody).digest();
    return timingSafeEqual(expected, received);
  });
}

function riskBand(score) {
  if (score > 100) return 'rate limited (not a score)';
  if (score >= 60) return 'dangerous';
  if (score >= 30) return 'suspicious';
  return 'trusted';
}

const [bodyFile, header] = process.argv.slice(2);
const usingSample = !bodyFile;
const rawBody = readFileSync(usingSample ? SAMPLE.body : bodyFile);
const secrets = usingSample
  ? [SAMPLE.secret]
  : (process.env.SHIELDLABS_WEBHOOK_SECRET ?? '').split(',').map((s) => s.trim()).filter(Boolean);

if (!verifySignature(rawBody, usingSample ? SAMPLE.header : header, secrets)) {
  console.error('signature: INVALID (check the secret and pass the raw body exactly as received)');
  process.exit(1);
}
console.log('signature: valid');

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(schema);
const event = JSON.parse(rawBody.toString('utf8'));
if (validate(event)) {
  console.log(`schema: valid (${event.event_type}, schema_version ${event.schema_version})`);
} else {
  // Log and keep going: a delivery should not be dropped only because a new field or value appeared.
  console.log('schema: does not match', validate.errors.map((e) => `${e.instancePath} ${e.message}`));
}

if (event.event_type === 'identification.scored') {
  const { data } = event;
  const flags = Object.entries(data.detection_flags ?? {}).filter(([, on]) => on).map(([flag]) => flag);
  console.log(`request_id: ${data.request_id}`);
  console.log(`risk_score: ${data.risk_score} (${riskBand(data.risk_score)})`);
  console.log(`detection flags: ${flags.join(', ') || 'none'}`);
}
