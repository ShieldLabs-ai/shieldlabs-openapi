import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAjv } from '../scripts/lib/validator.mjs';
import { readFixture } from '../scripts/lib/fixtures.mjs';
import { deref, freshBuild, operationById } from './helpers.mjs';

const RETIRED = ['is_abuser', 'is_datacenter', 'is_stun_not_checked'];
const FLAGS = [
  'is_vpn', 'is_tor', 'is_proxy', 'is_privacy_relay', 'network_check_incomplete',
  'check_incomplete', 'is_antidetect', 'is_os_mismatch', 'is_os_not_detected',
  'is_timezone_mismatch', 'is_js_disabled', 'is_browser_automation',
  'is_incognito', 'is_search_bot', 'ip_mismatch', 'latency_test', 'device_spoofing', 'banned_ip', 'ai_bot', 'ai_browser',
];

describe('public History field cleanup', () => {
  it('keeps the 20 supported flags, date/score bounds and paging parameters', () => {
    const { doc } = freshBuild();
    const { operation } = operationById(doc, 'listHistoryEntities');
    const names = operation.parameters.map((p) => deref(doc, p).name);
    assert.deepEqual(names.sort(), [
      'domain_id', 'resource', 'limit', 'page_token', 'from', 'to', 'snapshot',
      'risk_bands', 'hre_min_accounts', 'hre_min_devices', 'ids',
      'risk_signals', 'source', 'campaign', ...FLAGS,
    ].sort());
    assert.ok(operation.responses['400']);
    for (const name of RETIRED) assert.ok(operation.description.includes(name));
  });

  it('omits retired fields from the documented response properties and required list', () => {
    const { doc } = freshBuild();
    const row = doc.components.schemas.HistoryRow;
    for (const name of RETIRED) {
      assert.equal(Object.hasOwn(row.properties, name), false);
      assert.equal(row.required.includes(name), false);
    }
    assert.match(row.properties.network_check_incomplete.description, /network_check_incomplete/);
    assert.match(row.properties.is_privacy_relay.description, /private_relay/);
  });

  for (const name of RETIRED) {
    it(`rejects ${name} even when false in bundled and exported response schemas`, () => {
      const { files, validator } = freshBuild();
      const row = structuredClone(readFixture('history-page.json').data[0]);
      const rowExport = createAjv().compile(JSON.parse(files.get('schemas/history-row.schema.json')));
      const pageExport = createAjv().compile(JSON.parse(files.get('schemas/history-page.schema.json')));
      assert.equal(rowExport(row), true);
      for (const value of [false, true]) {
        const withRetired = { ...row, [name]: value };
        assert.equal(validator.validate({ $ref: '#/components/schemas/HistoryRow' }, withRetired).valid, false);
        assert.equal(rowExport(withRetired), false);
        const page = { ...readFixture('history-page.json'), data: [withRetired] };
        assert.equal(validator.validate({ $ref: '#/components/schemas/HistoryPage' }, page).valid, false);
        assert.equal(pageExport(page), false);
      }
      assert.equal(rowExport({ ...row, future_diagnostic: 'kept' }), true);
    });
  }

  it('requires the canonical network flag and accepts both boolean values', () => {
    const { files, validator } = freshBuild();
    const rowExport = createAjv().compile(JSON.parse(files.get('schemas/history-row.schema.json')));
    const pageExport = createAjv().compile(JSON.parse(files.get('schemas/history-page.schema.json')));
    const source = readFixture('history-page.json');
    for (const value of [false, true]) {
      const row = { ...source.data[0], network_check_incomplete: value };
      const page = { ...source, data: [row] };
      assert.equal(validator.validate({ $ref: '#/components/schemas/HistoryRow' }, row).valid, true);
      assert.equal(rowExport(row), true);
      assert.equal(pageExport(page), true);
    }
    const missing = { ...source.data[0] };
    delete missing.network_check_incomplete;
    assert.equal(rowExport(missing), false);
    assert.equal(validator.validate({ $ref: '#/components/schemas/HistoryRow' }, missing).valid, false);
  });

  it('accepts the current public row without eight historical diagnostic fields', () => {
    const { files, validator, doc } = freshBuild();
    const row = structuredClone(readFixture('history-page.json').data[0]);
    const obsolete = ['score_details', 'web_rtc_ip', 'web_rtc_country', 'web_rtc_connection_type', 'webrtc_leak_ip', 'webrtc_leak_country', 'webrtc_leak_connection_type', 'webrtc_leak_source'];
    for (const name of obsolete) { delete row[name]; assert.equal(doc.components.schemas.HistoryRow.required.includes(name), false); }
    assert.equal(validator.validate({ $ref: '#/components/schemas/HistoryRow' }, row).valid, true);
    const validate = createAjv().compile(JSON.parse(files.get('schemas/history-row.schema.json')));
    assert.equal(validate(row), true);
  });

});
