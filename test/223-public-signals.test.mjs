import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import path from 'node:path';
import {freshBuild,ROOT} from './helpers.mjs';

const KEYS=['vpn','proxy','private_relay','check_incomplete','network_check_incomplete','os_not_detected','timezone_mismatch','javascript_disabled','os_mismatch','ip_mismatch','latency_test','anti_detect_browser','device_spoofing','banned_ip','incognito','search_bot','ai_bot','browser_automation','ai_browser','tor'];

test('2026-10-13 public flags fold the internal detectors',()=>{
 const {doc,validator}=freshBuild();
 const schema=doc.components.schemas.IdentificationScoredEvent;
 const body=JSON.parse(readFileSync(path.join(ROOT,'test/contracts/219-named.json'),'utf8'));
 body.schema_version='2026-10-13';
 const flags=body.data.detection_flags;
 flags.banned_ip=flags.banned_ip;
 delete flags.banned_ip;
 flags.private_relay=flags.privacy_relay;
 flags.network_check_incomplete=flags.stun_not_checked;
 delete flags.privacy_relay;
 delete flags.stun_not_checked;
 delete flags.os_mismatch2;
 assert.deepEqual(Object.keys(flags).sort(),KEYS.toSorted());
 const valid=validator.validate(schema,body);
 assert.ok(valid.valid,JSON.stringify(valid.errors));
 for(const key of KEYS){
  const missing=structuredClone(body);
  delete missing.data.detection_flags[key];
  assert.equal(validator.validate(schema,missing).valid,false,key+' required');
 }
 for(const key of ['os_mismatch2','browser_vpn_proxy','privacy_relay','stun_not_checked','ws_tcp_latency','banned_ip']){
  const extra=structuredClone(body);
  extra.data.detection_flags[key]=false;
  assert.equal(validator.validate(schema,extra).valid,false,key+' is not public');
 }
});
