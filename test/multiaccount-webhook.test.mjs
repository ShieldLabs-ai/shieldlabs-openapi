import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {test} from 'node:test';
import {exportSchema} from '../scripts/lib/json-schema.mjs';
import {createAjv} from '../scripts/lib/validator.mjs';
import {ROOT} from '../scripts/lib/fixtures.mjs';

const schema=exportSchema(ROOT,{source:'spec/components/schemas/MultiaccountChangedEvent.yaml',file:'multiaccount-changed-event.schema.json'});
const validate=createAjv().compile(schema);
const union=createAjv().compile(exportSchema(ROOT,{source:'spec/models/WebhookEvent.yaml',file:'webhook-event.schema.json'}));
for (const action of ['detected','updated','resolved']) {
 test('Core wire fixture: '+action,()=>{
  const raw=readFileSync(new URL('./fixtures/webhook-multiaccount-'+action+'.json',import.meta.url));
  const e=JSON.parse(raw);
  assert.ok(validate(e),JSON.stringify(validate.errors));assert.ok(union(e),JSON.stringify(union.errors));
  assert.equal(e.data.action,action);assert.equal(e.data.users_count,e.data.user_hids.length);
  assert.deepEqual(e.data.user_hids,[...new Set(e.data.user_hids)].sort());
  assert.equal(e.data.revision,e.data.source.publication_version);
  const signed=createHmac('sha256','test_multiaccount_secret').update(raw).digest('hex');
  assert.notEqual(signed,createHmac('sha256','test_multiaccount_secret').update(Buffer.concat([raw,Buffer.from(' ')])).digest('hex'));
 });
}
test('known multi-account events cannot bypass result validation',()=>{
 const e=JSON.parse(readFileSync(new URL('./fixtures/webhook-multiaccount-detected.json',import.meta.url)));
 for (const mutate of [x=>x.data.level=null,x=>x.data.status='pending',x=>x.data.members_complete=false,x=>x.data.user_hids.push(x.data.user_hids[0]),x=>x.data.request_id='invented',x=>x.data.source.coverage_id='unknown']) {
  const bad=structuredClone(e);mutate(bad);assert.equal(union(bad),false);
 }
});
test('transition ancestry distinguishes a new episode from an existing group',()=>{
 for (const action of ['detected','updated','resolved']) {
  const event=JSON.parse(readFileSync(new URL('./fixtures/webhook-multiaccount-'+action+'.json',import.meta.url)));
  event.data.previous_revision=action==='detected'?'1':null;
  assert.equal(validate(event),false,action+' accepted invalid transition ancestry');
  assert.equal(union(event),false,action+' bypassed union validation');
 }
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/webhook-multiaccount-resolved.json',import.meta.url)));
 baseline.data.previous_revision='0';
 assert.ok(validate(baseline),JSON.stringify(validate.errors));
});
