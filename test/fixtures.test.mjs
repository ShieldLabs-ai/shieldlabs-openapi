// The shared SDK fixtures (vendored in test/fixtures/) match the spec and the JSON Schema exports.
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { FIXTURE_FILES, FIXTURES_DIR, readFixture } from '../scripts/lib/fixtures.mjs';
import { createAjv, describeErrors } from '../scripts/lib/validator.mjs';
import {
  DIAGNOSTIC_HISTORY_FIELDS,
  deref,
  freshBuild,
  operationById,
  TEST_DELIVERY_MISSING_FLAGS,
  testDeliveryMismatch,
  unexpectedUndocumented,
} from './helpers.mjs';

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const TEST_SECRET = 'whsec_00112233445566778899aabbccddeeff';

function assertValid(validator, schemaName, value, label) {
  const result = validator.validate(ref(schemaName), value);
  assert.ok(result.valid, `${label} against ${schemaName}: ${describeErrors(result.errors)}`);
}

function exportValidator(files, file) {
  const schema = JSON.parse(files.get(`schemas/${file}`));
  return createAjv().compile(schema);
}

describe('History API fixtures', () => {
  it('history-page.json and history-empty.json are valid History pages', () => {
    const { validator } = freshBuild();
    for (const file of ['history-page.json', 'history-empty.json']) {
      const page = readFixture(file);
      assertValid(validator, 'HistoryPage', page, file);
      assert.deepEqual(validator.inspect(ref('HistoryPage'), page).contentErrors, [], file);
    }
  });

  it('every History row is valid, parses its score_details and only adds diagnostic fields', () => {
    const { validator } = freshBuild();
    const { data } = readFixture('history-page.json');
    const extra = new Set();
    for (const row of data) {
      assertValid(validator, 'HistoryRow', row, row.request_id);
      const { contentErrors, undocumented } = validator.inspect(ref('HistoryRow'), row);
      assert.deepEqual(contentErrors, [], row.request_id);
      assert.deepEqual(unexpectedUndocumented(undocumented, 'history-row'), [], row.request_id);
      for (const key of undocumented) extra.add(key.slice(1));
    }
    assert.deepEqual([...extra].sort(), [...DIAGNOSTIC_HISTORY_FIELDS].sort());
  });
});

describe('webhook fixtures', () => {
  it('scored and rate-limited events are valid identification.scored events', () => {
    const { validator } = freshBuild();
    for (const file of ['webhook-identification-scored.json', 'webhook-rate-limited.json']) {
      const event = readFixture(file);
      assertValid(validator, 'IdentificationScoredEvent', event, file);
      const { undocumented } = validator.inspect(ref('IdentificationScoredEvent'), event);
      assert.deepEqual(undocumented, [], file);
    }
    const marker = readFixture('webhook-rate-limited.json').data;
    assert.equal(marker.risk_score, 999);
    assert.deepEqual(marker.signals, [{ name: 'rate_limited', weight: 999 }]);
  });

  it('the ping is a valid webhook.ping event', () => {
    const { validator } = freshBuild();
    const ping = readFixture('webhook-ping.json');
    assertValid(validator, 'WebhookPingEvent', ping, 'webhook-ping.json');
    assert.deepEqual(validator.inspect(ref('WebhookPingEvent'), ping).undocumented, []);
  });

  it('raw bodies parse to the pretty fixtures and carry the documented example signatures', () => {
    const { doc } = freshBuild();
    const signature = (id) => {
      const { operation } = operationById(doc, id);
      const header = operation.parameters.map((p) => deref(doc, p)).find((p) => p.name === 'X-Shield-Signature');
      return header.examples[id].value;
    };
    const cases = [
      ['webhook-identification-scored', 'identificationScored'],
      ['webhook-ping', 'webhookPing'],
    ];
    for (const [name, operationId] of cases) {
      const raw = readFileSync(path.join(FIXTURES_DIR, `${name}.raw.txt`));
      assert.deepEqual(JSON.parse(raw.toString('utf8')), readFixture(`${name}.json`), name);
      const digest = createHmac('sha256', Buffer.from(TEST_SECRET, 'utf8')).update(raw).digest('hex');
      assert.equal(`sha256=${digest}`, signature(operationId), name);
    }
    const scoredRaw = readFileSync(path.join(FIXTURES_DIR, 'webhook-identification-scored.raw.txt'), 'utf8');
    assert.ok(scoredRaw.includes('\\u0026'), 'the raw scored body keeps & escaped as \\u0026');
  });

  it('the analytics dashboard test delivery fails only on its two missing flags', () => {
    const { validator } = freshBuild();
    const delivery = readFixture('webhook-test-delivery.json');
    const result = validator.validate(ref('IdentificationScoredEvent'), delivery);
    assert.equal(result.valid, false);
    assert.equal(testDeliveryMismatch(result.errors, '/data/detection_flags'), null);
    const completed = structuredClone(delivery);
    for (const flag of TEST_DELIVERY_MISSING_FLAGS) completed.data.detection_flags[flag] = false;
    assertValid(validator, 'IdentificationScoredEvent', completed, 'test delivery with both flags');
  });
});

describe('Management API fixtures', () => {
  it('management-profile.json is a valid domain profile', () => {
    const { validator } = freshBuild();
    const profile = readFixture('management-profile.json');
    assertValid(validator, 'DomainProfile', profile, 'management-profile.json');
    assert.deepEqual(validator.inspect(ref('DomainProfile'), profile).undocumented, []);
  });
});

describe('normalization cases', () => {
  it('inputs are valid History rows and webhook data (the test delivery lacks two flags)', () => {
    const { validator } = freshBuild();
    const { cases } = readFixture('normalization-cases.json');
    assert.ok(cases.length >= 8);
    for (const testCase of cases) {
      if (testCase.source === 'history') {
        assertValid(validator, 'HistoryRow', testCase.input, testCase.name);
        assert.deepEqual(validator.inspect(ref('HistoryRow'), testCase.input).contentErrors, [], testCase.name);
      } else {
        assert.equal(testCase.source, 'webhook');
        const result = validator.validate(ref('IdentificationScoredData'), testCase.input);
        if (testCase.name === 'webhook_test_delivery') {
          assert.equal(testDeliveryMismatch(result.errors, '/detection_flags'), null, testCase.name);
        } else {
          assert.ok(result.valid, `${testCase.name}: ${describeErrors(result.errors)}`);
        }
      }
    }
  });

  it('expected outputs match the exported Identification model', () => {
    const { files } = freshBuild();
    const validate = exportValidator(files, 'identification.schema.json');
    for (const testCase of readFixture('normalization-cases.json').cases) {
      assert.ok(validate(testCase.expected), `${testCase.name}: ${describeErrors(validate.errors)}`);
      assert.equal(testCase.expected.source, testCase.source, testCase.name);
    }
  });
});

describe('error responses', () => {
  // Cases the servers can send but the operations do not document, and why.
  const UNDOCUMENTED = {
    'management 402': 'SDKs map 402 defensively; these Management endpoints never debit included identifications',
  };
  const OPERATIONS = { history: ['searchHistory'], management: ['getDomainProfile', 'searchHistoryDeprecated'] };
  // Cases that only one operation of a surface can produce.
  const ONLY = { 'management 400': ['searchHistoryDeprecated'] };

  it('every case is documented, with a matching schema, on each operation of its surface that can send it', () => {
    const { doc, validator } = freshBuild();
    const undocumented = [];
    for (const testCase of readFixture('error-responses.json').cases) {
      const label = `${testCase.surface} ${testCase.status}`;
      if (label in UNDOCUMENTED) {
        undocumented.push(label);
        for (const id of OPERATIONS[testCase.surface]) {
          assert.equal(operationById(doc, id).operation.responses[String(testCase.status)], undefined, `${id} ${label}`);
        }
        continue;
      }
      const mediaType = testCase.content_type ? testCase.content_type.split(';')[0].trim() : null;
      for (const id of ONLY[label] ?? OPERATIONS[testCase.surface]) {
        const where = `${id} ${label}`;
        const raw = operationById(doc, id).operation.responses[String(testCase.status)];
        assert.ok(raw, `${where} is not documented`);
        const response = deref(doc, raw);
        if (mediaType === null) {
          assert.equal(testCase.body, '', `${where} has no content type, so no body`);
          assert.equal(response.content, undefined, `${where}: the documented response has a body`);
          continue;
        }
        const media = response.content?.[mediaType];
        assert.ok(media, `${where}: ${mediaType} is not documented`);
        const value = mediaType === 'application/json' ? JSON.parse(testCase.body) : testCase.body;
        const result = validator.validate(media.schema, value);
        assert.ok(result.valid, `${where}: ${describeErrors(result.errors)}`);
        assert.deepEqual(validator.inspect(media.schema, value).contentErrors, [], where);
      }
    }
    assert.deepEqual(undocumented.sort(), Object.keys(UNDOCUMENTED).sort());
  });
});

describe('risk band cases', () => {
  const band = (score) => {
    if (score > 100) return 'rate_limited';
    if (score >= 60) return 'dangerous';
    if (score >= 30) return 'suspicious';
    return 'trusted';
  };

  it('scores are valid Risk Scores and follow the documented bands', () => {
    const { validator } = freshBuild();
    for (const { score, band: expected } of readFixture('risk-band-cases.json').cases) {
      assertValid(validator, 'RiskScore', score, `score ${score}`);
      assert.equal(band(score), expected, `score ${score}`);
    }
  });
});

describe('webhook signature vectors', () => {
  const HEADER = /^sha256=([0-9a-fA-F]{64})$/;

  // The algorithm exactly as the spec describes it, with the header leniency the vectors expect
  // (surrounding whitespace, upper-case hex) and a list of secrets for rotation.
  function verify(body, header, secrets) {
    const match = String(header ?? '').trim().match(HEADER);
    if (!match) return false;
    const received = Buffer.from(match[1].toLowerCase(), 'hex');
    return secrets.some((secret) => {
      if (!secret) return false;
      const expected = createHmac('sha256', Buffer.from(secret, 'utf8')).update(body).digest();
      return timingSafeEqual(expected, received);
    });
  }

  it('the documented algorithm reproduces every vector', () => {
    const { doc } = freshBuild();
    const pattern = new RegExp(deref(doc, doc.components.parameters.ShieldSignature).schema.pattern);
    const { vectors } = readFixture('webhook-signature-vectors.json');
    assert.equal(vectors.length, 21);
    for (const vector of vectors) {
      const body = Buffer.from(vector.body_base64, 'base64');
      const secrets = vector.secrets ?? [vector.secret];
      assert.equal(verify(body, vector.signature_header, secrets), vector.valid, vector.name);
      if (vector.valid && vector.signature_header === vector.signature_header.trim().toLowerCase()) {
        assert.match(vector.signature_header, pattern, `${vector.name} is canonical`);
      }
    }
  });
});

describe('JSON Schema exports', () => {
  it('validate the webhook and History fixtures', () => {
    const { files } = freshBuild();
    const scored = exportValidator(files, 'identification-scored-event.schema.json');
    const ping = exportValidator(files, 'webhook-ping-event.schema.json');
    const any = exportValidator(files, 'webhook-event.schema.json');
    const page = exportValidator(files, 'history-page.schema.json');
    const row = exportValidator(files, 'history-row.schema.json');
    for (const file of ['webhook-identification-scored.json', 'webhook-rate-limited.json']) {
      assert.ok(scored(readFixture(file)), `${file}: ${describeErrors(scored.errors)}`);
      assert.ok(any(readFixture(file)), `${file}: ${describeErrors(any.errors)}`);
    }
    assert.ok(ping(readFixture('webhook-ping.json')), describeErrors(ping.errors));
    assert.ok(any(readFixture('webhook-ping.json')), describeErrors(any.errors));
    assert.ok(page(readFixture('history-page.json')), describeErrors(page.errors));
    assert.ok(page(readFixture('history-empty.json')), describeErrors(page.errors));
    for (const item of readFixture('history-page.json').data) assert.ok(row(item), describeErrors(row.errors));

    assert.equal(scored(readFixture('webhook-test-delivery.json')), false);
    assert.equal(testDeliveryMismatch(scored.errors, '/data/detection_flags'), null);
    assert.equal(any(readFixture('webhook-test-delivery.json')), false);
    assert.equal(ping(readFixture('webhook-identification-scored.json')), false, 'events are not interchangeable');
  });

  it('accept values added in later versions', () => {
    const { files } = freshBuild();
    const scored = exportValidator(files, 'identification-scored-event.schema.json');
    const row = exportValidator(files, 'history-row.schema.json');
    const identification = exportValidator(files, 'identification.schema.json');

    const event = structuredClone(readFixture('webhook-identification-scored.json'));
    event.schema_version = '2027-01-01.beta';
    Object.assign(event.data, { connection_type: 'satellite', device_type: 'watch' });
    Object.assign(event.data.traffic_source, { channel: 'Newsletter', click_id_type: 'yclid' });
    assert.ok(scored(event), describeErrors(scored.errors));

    const history = structuredClone(readFixture('history-page.json').data[0]);
    Object.assign(history, {
      connection_type: 'satellite',
      device_type: 'watch',
      traffic_channel: 'Newsletter',
      traffic_channel_group: 'Email',
      traffic_reason: 'newsletter_link',
      click_id_type: 'yclid',
      web_rtc_connection_type: 'satellite',
      webrtc_leak_source: 'extension',
    });
    assert.ok(row(history), describeErrors(row.errors));

    const expected = structuredClone(readFixture('normalization-cases.json').cases[0].expected);
    expected.connection_type = 'satellite';
    assert.ok(identification(expected), describeErrors(identification.errors));
  });

  it('accept an unknown event type by its envelope alone', () => {
    const { files } = freshBuild();
    const any = exportValidator(files, 'webhook-event.schema.json');
    const future = {
      event_type: 'example.future',
      schema_version: '2027-01-01',
      created_at: '2027-01-01T00:00:00Z',
      data: { x: 1 },
    };
    assert.ok(any(future), describeErrors(any.errors));
    const scoredWithoutData = {
      event_type: 'identification.scored',
      schema_version: '2026-06-01',
      created_at: '2026-09-30T12:34:56Z',
    };
    assert.equal(any(scoredWithoutData), false);
  });
});

describe('vendored fixtures', () => {
  it('equal the shared fixture set when FIXTURES_DIR points to it', (t) => {
    const source = process.env.FIXTURES_DIR;
    if (!source) {
      t.skip('set FIXTURES_DIR to compare test/fixtures/ with the shared fixture set');
      return;
    }
    for (const file of FIXTURE_FILES) {
      assert.ok(
        readFileSync(path.join(source, file)).equals(readFileSync(path.join(FIXTURES_DIR, file))),
        `${file} differs: run npm run sync:fixtures -- --from "$FIXTURES_DIR"`,
      );
    }
  });
});
