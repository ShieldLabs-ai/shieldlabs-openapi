import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import path from 'node:path';
import {freshBuild,ROOT} from './helpers.mjs';

const KEYS=['vpn','proxy','privacy_relay','check_incomplete','stun_not_checked','os_not_detected','timezone_mismatch','javascript_disabled','os_mismatch','os_mismatch2','ip_mismatch','latency_test','anti_detect_browser','device_spoofing','banned_ip','incognito','search_bot','ai_bot','browser_automation','ai_browser','tor'];
for(const name of ['named','ai-bot','ai-browser']) test('Core #219 emitted '+name+' validates with exactly 21 signals',()=>{
 const {doc,validator}=freshBuild();
 const schema=doc.components.schemas.IdentificationScoredEvent;
 const body=JSON.parse(readFileSync(path.join(ROOT,'test/contracts/219-'+name+'.json'),'utf8'));
 assert.equal(body.schema_version,'2026-10-12');
 assert.deepEqual(Object.keys(body.data.detection_flags).sort(),KEYS.toSorted());
 const valid=validator.validate(schema,body); assert.ok(valid.valid,JSON.stringify(valid.errors));
 for(const key of KEYS) {
  const missing=structuredClone(body);delete missing.data.detection_flags[key];
  assert.equal(validator.validate(schema,missing).valid,false,key+' required');
 }
 for(const key of ['browser_vpn_proxy','datacenter_ip','abuser','suspicious_paid_click','good_bot','bad_bot','ai_bot_owner']) {
  const extra=structuredClone(body);extra.data.detection_flags[key]=false;
  assert.equal(validator.validate(schema,extra).valid,false,key+' outside canon');
 }
 for(const [first,second] of [[false,true],[true,false]]) {
  const distinct=structuredClone(body);distinct.data.detection_flags.os_mismatch=first;distinct.data.detection_flags.os_mismatch2=second;
  assert.equal(validator.validate(schema,distinct).valid,true,'independent OS detectors');
 }
 assert.equal(body.data.detection_flags.ai_bot,name==='ai-bot');
 assert.equal(body.data.detection_flags.ai_browser,name==='ai-browser');
});
