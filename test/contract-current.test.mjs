import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe,it} from 'node:test';
import {freshBuild,ROOT} from './helpers.mjs';
import path from 'node:path';
describe('Core 2026-10-09 fixtures',()=>{
 for(const name of ['named','anonymous','no-history','banned','incomplete'])it(name,()=>{
  const fixture=JSON.parse(readFileSync(path.join(ROOT,'test/contracts',name+'.json'),'utf8'));
  const {doc,validator}=freshBuild();const schema=doc.components.schemas.IdentificationScoredEvent;
  const result=validator.validate(schema,fixture);assert.ok(result.valid,JSON.stringify(result.errors));
  for (const key of ['browser_vpn_proxy','datacenter_ip','abuser','suspicious_paid_click']) {
   assert.equal(fixture.data.detection_flags[key],undefined);
   const broken=structuredClone(fixture);broken.data.detection_flags[key]=false;
   assert.equal(validator.validate(schema,broken).valid,false,key+' forbidden');
  }
  for (const field of ['connection_type','signals']) {
   const broken=structuredClone(fixture);
   if (field==='connection_type') broken.data.connection_type='browser_vpn_proxy';
   else broken.data.signals=[{name:'browser_vpn_proxy',weight:30}];
   assert.equal(validator.validate(schema,broken).valid,false,field+' must unify VPN');
  }
  for (const key of ['result_version','scoring_version']) {
   assert.equal(fixture.data[key],undefined);
   const broken=structuredClone(fixture);broken.data[key]='legacy';
   assert.equal(validator.validate(schema,broken).valid,false,key+' forbidden');
  }
  assert.equal(fixture.data.risk_events,undefined);
  assert.equal(fixture.data.fingerprint,undefined);
  assert.equal(fixture.data.detection_flags.os_mismatch2,undefined);
  for(const result of Object.values(fixture.data.hre).filter(v=>v && typeof v==='object')) assert.ok('cluster_id' in result);
  assert.equal(fixture.data.entity_risks,undefined);
  const missing=structuredClone(fixture);delete missing.event_id;
  assert.equal(validator.validate(schema,missing).valid,false);
  for(const key of ['hre']){
   const broken=structuredClone(fixture);delete broken.data[key];
   assert.equal(validator.validate(schema,broken).valid,false,key+' required');
  }
 });
});
