import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe,it} from 'node:test';
import {freshBuild,ROOT} from './helpers.mjs';
import path from 'node:path';
describe('Core 2026-10-06 fixtures',()=>{
 for(const name of ['named','anonymous','no-history','banned','incomplete'])it(name,()=>{
  const fixture=JSON.parse(readFileSync(path.join(ROOT,'test/contracts',name+'.json'),'utf8'));
  const {doc,validator}=freshBuild();const schema=doc.components.schemas.IdentificationScoredEvent;
  const result=validator.validate(schema,fixture);assert.ok(result.valid,JSON.stringify(result.errors));
  assert.equal(fixture.data.risk_events.length,19);
  assert.equal(new Set(fixture.data.risk_events.map(r=>r.code)).size,19);
  assert.ok(!fixture.data.risk_events.some(r=>r.code.startsWith('ai_')));
  assert.equal(fixture.data.entity_risks,undefined);
  const missing=structuredClone(fixture);delete missing.event_id;
  assert.equal(validator.validate(schema,missing).valid,false);
  for(const key of ['risk_events','hre','result_version','scoring_version']){
   const broken=structuredClone(fixture);delete broken.data[key];
   assert.equal(validator.validate(schema,broken).valid,false,key+' required');
  }
 });
});
