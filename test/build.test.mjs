// dist/ freshness and the structure of the bundled document.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import YAML from 'yaml';
import { deref, freshBuild, mediaTypes, operationById, operations, ROOT } from './helpers.mjs';

const HISTORY_HOST = 'https://account.shieldlabs.ai';
const MANAGEMENT_HOST = 'https://api.shieldlabs.ai';

const FLAGS = [
  'vpn', 'privacy_relay', 'browser_vpn_proxy', 'tor', 'proxy', 'datacenter_ip', 'abuser',
  'os_mismatch', 'os_not_detected', 'timezone_mismatch', 'anti_detect_browser',
  'browser_automation', 'ip_mismatch', 'incognito', 'search_bot', 'suspicious_paid_click',
  'javascript_disabled', 'stun_not_checked', 'check_incomplete',
];
const WEBHOOK_DATA_KEYS = [
  'request_id', 'visitor_id', 'device_id', 'session_id', 'cookie_id', 'user_hid', 'domain',
  'public_ip', 'local_ip', 'connection_type', 'os', 'browser', 'device_type', 'traffic_source',
  'risk_score', 'signals', 'detection_flags', 'observed_at',
];

function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full, base) : [path.relative(base, full)];
  });
}

describe('dist/', () => {
  it('matches a fresh build of spec/ byte for byte (run `npm run bundle` after editing spec/)', () => {
    const { files } = freshBuild();
    const distDir = path.join(ROOT, 'dist');
    assert.ok(existsSync(distDir), 'dist/ is missing');
    assert.deepEqual(listFiles(distDir).sort(), [...files.keys()].sort(), 'dist/ has a different set of files');
    for (const [relative, content] of files) {
      const current = readFileSync(path.join(distDir, relative), 'utf8');
      assert.ok(current === content, `dist/${relative} is stale: run npm run bundle`);
    }
  });

  it('holds the same document as YAML and JSON', () => {
    const { files, doc } = freshBuild();
    assert.deepEqual(YAML.parse(files.get('shieldlabs-api.yaml')), doc);
  });
});

describe('document', () => {
  it('describes the ShieldLabs API 1.0.1 in OpenAPI 3.1', () => {
    const { doc } = freshBuild();
    assert.equal(doc.openapi, '3.1.0');
    assert.equal(doc.info.title, 'ShieldLabs API');
    assert.equal(doc.info.version, '1.0.1');
    assert.equal(doc.info.contact.email, 'contact@shieldlabs.ai');
    assert.equal(doc.info.license.identifier, 'MIT');
    assert.equal(doc.externalDocs.url, 'https://docs.shieldlabs.ai');
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(doc.info.version, pkg.version, 'info.version follows the package version');
  });

  it('has exactly the public operations, with their own servers', () => {
    const { doc } = freshBuild();
    const found = operations(doc).map((op) => [op.kind, op.key, op.method, op.operation.operationId]);
    assert.deepEqual(found.sort(), [
      ['path', '/api/v1/history/{search_type}/{value}', 'get', 'searchHistory'],
      ['path', '/health', 'get', 'getHealth'],
      ['path', '/v1/history/{type}/{value}', 'get', 'searchHistoryDeprecated'],
      ['path', '/v1/profile', 'get', 'getDomainProfile'],
      ['webhook', 'identification.scored', 'post', 'identificationScored'],
      ['webhook','multi-account-changed','post','multiaccountChanged'],
      ['webhook', 'webhook.ping', 'post', 'webhookPing'],
    ].sort());

    const servers = (id) => {
      const { pathItem, operation } = operationById(doc, id);
      return (operation.servers ?? pathItem.servers).map((s) => s.url);
    };
    assert.deepEqual(servers('searchHistory'), [HISTORY_HOST]);
    assert.deepEqual(servers('getDomainProfile'), [MANAGEMENT_HOST]);
    assert.deepEqual(servers('searchHistoryDeprecated'), [MANAGEMENT_HOST]);
    assert.deepEqual(servers('getHealth').sort(), [HISTORY_HOST, MANAGEMENT_HOST].sort());
  });

  it('never produces a doubled /api/api prefix', () => {
    const { doc } = freshBuild();
    for (const { kind, key, pathItem, operation } of operations(doc)) {
      if (kind !== 'path') continue;
      for (const server of operation.servers ?? pathItem.servers ?? doc.servers) {
        const url = new URL(server.url + key.replace(/[{}]/g, ''));
        assert.ok(!url.pathname.includes('/api/api'), `${server.url}${key}`);
      }
    }
    for (const server of doc.servers) assert.ok(!/\/api\/?$/.test(server.url), server.url);
  });

  it('secures History with the Private API Key and Management with the Secret Key plus X-Shield-Domain', () => {
    const { doc } = freshBuild();
    const { historyApiKey, managementSecretKey } = doc.components.securitySchemes;
    assert.equal(historyApiKey.type, 'http');
    assert.equal(historyApiKey.scheme, 'bearer');
    assert.equal(managementSecretKey.type, 'http');
    assert.equal(managementSecretKey.scheme, 'bearer');
    assert.deepEqual(operationById(doc, 'searchHistory').operation.security, [{ historyApiKey: [] }]);
    for (const id of ['getDomainProfile', 'searchHistoryDeprecated']) {
      const { operation } = operationById(doc, id);
      assert.deepEqual(operation.security, [{ managementSecretKey: [] }], id);
      const header = operation.parameters.map((p) => deref(doc, p)).find((p) => p.name === 'X-Shield-Domain');
      assert.ok(header, `${id} lacks X-Shield-Domain`);
      assert.equal(header.in, 'header');
      assert.equal(header.required, true);
    }
    for (const id of ['getHealth', 'identificationScored', 'webhookPing']) {
      assert.deepEqual(operationById(doc, id).operation.security, [], id);
    }
  });

  it('marks the Management history endpoint deprecated with its Sunset date and successor', () => {
    const { doc } = freshBuild();
    const { operation } = operationById(doc, 'searchHistoryDeprecated');
    assert.equal(operation.deprecated, true);
    assert.match(operation.description, /Sat, 01 Jan 2027 00:00:00 GMT/);
    assert.match(operation.description, /https:\/\/account\.shieldlabs\.ai\/api\/v1\/history/);
    // The router answers unrouted paths before the route adds its headers.
    assert.match(deref(doc, operation.responses['404']).description, /router and carries no\s+deprecation headers/);
    for (const status of ['200', '400', '401', '404']) {
      const headers = deref(doc, operation.responses[status]).headers;
      assert.equal(deref(doc, headers.Deprecation).schema.const, 'true', status);
      assert.equal(deref(doc, headers.Sunset).schema.const, 'Sat, 01 Jan 2027 00:00:00 GMT', status);
      assert.equal(
        deref(doc, headers.Link).schema.const,
        '<https://account.shieldlabs.ai/api/v1/history>; rel="successor-version"',
        status,
      );
    }
    for (const status of ['429', '503']) {
      assert.equal(deref(doc, operation.responses[status]).headers, undefined, status);
    }
  });

  it('documents the webhook signature header with the exact format', () => {
    const { doc } = freshBuild();
    for (const id of ['identificationScored', 'webhookPing','multiaccountChanged']) {
      const { operation } = operationById(doc, id);
      const header = operation.parameters.map((p) => deref(doc, p)).find((p) => p.name === 'X-Shield-Signature');
      assert.ok(header, id);
      assert.equal(header.in, 'header');
      assert.equal(header.required, true);
      assert.equal(header.schema.pattern, '^sha256=[0-9a-f]{64}$');
      assert.match(header.description, /whsec_/);
      assert.match(header.description, /raw request body/);
    }
  });

  it('gives every operation a summary, a description and complete responses', () => {
    const { doc } = freshBuild();
    for (const { operation } of operations(doc)) {
      const id = operation.operationId;
      assert.ok(operation.summary, `${id} summary`);
      assert.ok(operation.description?.length > 80, `${id} description`);
      assert.equal(operation.tags?.length, 1, `${id} tag`);
      for (const [status, raw] of Object.entries(operation.responses)) {
        assert.ok(deref(doc, raw).description, `${id} ${status} description`);
      }
      for (const { where, mediaType, media } of mediaTypes(doc, operation)) {
        assert.ok(media.schema, `${id} ${where} ${mediaType} schema`);
        assert.ok(Object.keys(media.examples ?? {}).length > 0, `${id} ${where} ${mediaType} examples`);
      }
      for (const raw of operation.parameters ?? []) {
        const parameter = deref(doc, raw);
        assert.ok(parameter.description, `${id} ${parameter.name} description`);
        assert.ok(parameter.schema, `${id} ${parameter.name} schema`);
        assert.ok(Object.keys(parameter.examples ?? {}).length > 0, `${id} ${parameter.name} examples`);
      }
    }
  });

  it('never documents a 402: these endpoints do not use included identifications', () => {
    const { doc } = freshBuild();
    for (const { operation } of operations(doc)) {
      assert.ok(!('402' in operation.responses), operation.operationId);
    }
  });

  it('documents error bodies as the servers send them', () => {
    const { doc } = freshBuild();
    const content = (id, status) => deref(doc, operationById(doc, id).operation.responses[status]).content;
    assert.deepEqual(Object.keys(content('searchHistory', '401')), ['text/plain']);
    assert.deepEqual(Object.keys(content('searchHistory', '429')), ['application/json']);
    assert.deepEqual(Object.keys(content('searchHistory', '500')).sort(), ['application/json', 'text/plain']);
    assert.equal(content('getDomainProfile', '401'), undefined, 'Management 401 has an empty body');
    assert.equal(content('searchHistoryDeprecated', '401'), undefined, 'Management 401 has an empty body');
    for (const id of ['searchHistory', 'getDomainProfile', 'getHealth']) {
      assert.deepEqual(Object.keys(content(id, '404')), ['text/plain'], `${id} 404`);
    }
    assert.deepEqual(Object.keys(content('searchHistoryDeprecated', '404')).sort(), ['application/json', 'text/plain']);
    const badRequest = deref(doc, content('searchHistoryDeprecated', '400')['application/json'].schema);
    assert.deepEqual(badRequest.type, ['string', 'null']);
    for (const id of ['getDomainProfile', 'searchHistoryDeprecated']) {
      for (const status of ['429', '503']) {
        assert.deepEqual(Object.keys(content(id, status)), ['application/json'], `${id} ${status}`);
      }
    }
  });
});

describe('schemas', () => {
  it('require all 19 detection flags', () => {
    const { doc } = freshBuild();
    const flags = doc.components.schemas.DetectionFlags;
    assert.deepEqual([...flags.required].sort(), [...FLAGS].sort());
    assert.deepEqual(Object.keys(flags.properties).sort(), [...FLAGS, "os_mismatch2", "device_spoofing", "latency_test", "banned_ip", "ai_bot", "ai_browser"].sort());
    for (const flag of FLAGS) assert.equal(flags.properties[flag].type, 'boolean', flag);
  });

  it('require all 18 keys of the webhook data, with a nullable user_hid', () => {
    const { doc } = freshBuild();
    const data = doc.components.schemas.IdentificationScoredData;
    assert.deepEqual([...data.required].sort(), [...WEBHOOK_DATA_KEYS].sort());
    assert.deepEqual(Object.keys(data.properties).sort(), [...WEBHOOK_DATA_KEYS, "result_version", "scoring_version", "risk_events", "hre", "client_identity"].sort());
    assert.deepEqual(doc.components.schemas.UserHid.type, ['string', 'null']);
  });

  it('allow the 999 rate-limit marker in the Risk Score', () => {
    const { doc } = freshBuild();
    const score = doc.components.schemas.RiskScore;
    assert.equal(score.type, 'integer');
    assert.equal(score.minimum, 0);
    assert.equal(score.maximum, undefined);
    assert.match(score.description, /999/);
    assert.match(score.description, /trusted: 0-29/);
    assert.match(score.description, /suspicious: 30-59/);
    assert.match(score.description, /dangerous: 60-100/);
  });

  it('list the eight connection types as known values of an open set', () => {
    const { doc } = freshBuild();
    const connectionType = doc.components.schemas.ConnectionType;
    assert.equal(connectionType.type, 'string');
    assert.equal(connectionType.enum, undefined);
    assert.deepEqual(connectionType['x-extensible-enum'], [
      'direct', 'mobile', 'vpn', 'proxy', 'tor', 'privacy_relay', 'browser_vpn_proxy', 'unknown',
    ]);
  });

  it('keep response values open: known values are listed, never a closed enum', () => {
    const { doc } = freshBuild();
    const open = [];
    const visit = (label, schema) => {
      if (!schema || typeof schema !== 'object') return;
      // The dated group-transition protocol has a finite state machine. Network,
      // device and classification response values remain extensible.
      const finite = {'MultiaccountChangedData.action':['detected','updated','resolved'], 'MultiaccountChangedData.level':['medium','high',null]};
      if (finite[label]) assert.deepEqual(schema.enum,finite[label],label);
      else assert.equal(schema.enum, undefined, `${label} is a closed enum`);
      if (schema['x-extensible-enum']) {
        open.push(label);
        assert.equal(schema.type, 'string', label);
        for (const value of schema['x-extensible-enum'].filter(Boolean)) {
          assert.ok(schema.description.includes(`\`${value}\``), `${label} does not describe ${value}`);
        }
        assert.match(schema.description, /The set is open/, label);
      }
      for (const [key, child] of Object.entries(schema.properties ?? {})) visit(`${label}.${key}`, child);
      if (schema.items) visit(`${label}[]`, schema.items);
      if (schema.contentSchema) visit(`${label}<json>`, schema.contentSchema);
    };
    for (const [name, schema] of Object.entries(doc.components.schemas)) visit(name, schema);
    assert.deepEqual(open.sort(), [
      'ClickIdType', 'ConnectionType', 'DeviceType', 'HistoryRow.webrtc_leak_source', 'NetworkClass',
      'TrafficChannel', 'TrafficChannelGroup', 'TrafficReason',
    ]);
    const schemaVersion = doc.components.schemas.SchemaVersion;
    assert.equal(schemaVersion.type, 'string');
    assert.equal(schemaVersion.pattern, undefined, 'any schema_version is accepted');
    assert.equal(schemaVersion.minLength, 1);
  });

  it('describe countries as English names and the IP sentinels', () => {
    const { doc } = freshBuild();
    assert.match(doc.components.schemas.Country.description, /English country name/);
    assert.ok(doc.components.schemas.Ipv4.examples.includes('0.0.0.0'));
    assert.ok(doc.components.schemas.Ipv4OrEmpty.examples.includes(''));
  });

  it('keep History rows open and give created_at its real format', () => {
    const { doc } = freshBuild();
    const row = doc.components.schemas.HistoryRow;
    assert.equal(row.additionalProperties, true);
    assert.equal(row.properties.score_details.type, 'string');
    assert.equal(row.properties.score_details.contentMediaType, 'application/json');
    const created = doc.components.schemas.HistoryTimestamp;
    assert.equal(created.format, undefined, 'History created_at is not RFC 3339');
    const pattern = new RegExp(created.pattern);
    assert.ok(pattern.test('2026-09-30 12:34:56.123'));
    assert.ok(pattern.test('2026-09-30 13:05:12'));
    assert.ok(!pattern.test('2026-09-30T12:34:56.123Z'));
  });

  it('describe how to send a User HID in the History API path', () => {
    const { doc } = freshBuild();
    const value = deref(doc, doc.components.parameters.HistoryValue);
    assert.match(value.description, /`A-Z a-z 0-9 - \. _ ~ \$ & \+ , : ; = @` unescaped/);
    assert.match(value.description, /uppercase `%XX`/);
    const pattern = new RegExp(value.schema.pattern);
    for (const ok of ['anonymous', 'a5b7c9d1-e3f5-4a7b-9c1d-3e5f7a9b1c3d', '203.0.113.24', 'a@b', 'x y', '...', '.a', 'a.b', '-1']) {
      assert.ok(pattern.test(ok), ok);
    }
    for (const bad of ['.', '..', 'a/b', '/', '']) assert.ok(!pattern.test(bad), JSON.stringify(bad));
  });

  it('keep signal names an open set', () => {
    const { doc } = freshBuild();
    const name = doc.components.schemas.Signal.properties.name;
    assert.equal(name.type, 'string');
    assert.equal(name.enum, undefined);
    for (const slug of ['vpn', 'proxy', 'antidetect_browser', 'stun_late_correction', 'rate_limited']) {
      assert.match(name.description, new RegExp(`\`${slug}\``), slug);
    }
  });
});

describe('lint exceptions', () => {
  it('ignore only the two missing flags of the test delivery example', () => {
    const ignore = YAML.parse(readFileSync(path.join(ROOT, '.redocly.lint-ignore.yaml'), 'utf8'));
    assert.deepEqual(ignore, {
      'spec/components/examples/IdentificationScoredTestDelivery.yaml': {
        'no-invalid-media-type-examples': ['#/value/data/detection_flags'],
      },
    });
  });
});
