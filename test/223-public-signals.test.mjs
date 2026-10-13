import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import path from 'node:path';
import {freshBuild,ROOT} from './helpers.mjs';

const KEYS=['vpn','proxy','privacy_relay','check_incomplete','stun_not_checked','os_not_detected','timezone_mismatch','javascript_disabled','os_mismatch','ip_mismatch','ws_tcp_latency','anti_detect_browser','device_spoofing','rate_limited','incognito','search_bot','ai_bot','browser_automation','ai_browser','tor'];

test('2026-10-13 public flags fold the internal detectors',()=>{
 const {doc,validator}=freshBuild();
 const schema=doc.components.schemas.IdentificationScoredEvent;
 const body=JSON.parse(readFileSync(path.join(ROOT,'test/contracts/219-named.json'),'utf8'));
 body.schema_version='2026-10-13';
 const flags=body.data.detection_flags;
 flags.ws_tcp_latency=flags.latency_test;
 flags.rate_limited=flags.banned_ip;
 delete flags.latency_test;
 delete flags.banned_ip;
 delete flags.os_mismatch2;
 assert.deepEqual(Object.keys(flags).sort(),KEYS.toSorted());
 const valid=validator.validate(schema,body);
 assert.ok(valid.valid,JSON.stringify(valid.errors));
 for(const key of KEYS){
  const missing=structuredClone(body);
  delete missing.data.detection_flags[key];
  assert.equal(validator.validate(schema,missing).valid,false,key+' required');
 }
 for(const key of ['os_mismatch2','browser_vpn_proxy','latency_test','banned_ip']){
  const extra=structuredClone(body);
  extra.data.detection_flags[key]=false;
  assert.equal(validator.validate(schema,extra).valid,false,key+' is not public');
 }
});
