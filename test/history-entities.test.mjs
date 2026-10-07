import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const doc=JSON.parse(readFileSync(new URL('../spec/history-entities/openapi.json',import.meta.url),'utf8'));
const ajv=new Ajv({strict:false,allErrors:true});addFormats(ajv);
const root={$id:'https://shieldlabs.test/entities-v1',components:doc.components};ajv.addSchema(root);
const validate=(name,data)=>{const fn=ajv.compile({$ref:root.$id+'#/components/schemas/'+name});return {ok:fn(data),errors:fn.errors}};
const fixture=(name)=>JSON.parse(readFileSync(new URL(`./history-entities/${name}.json`,import.meta.url),'utf8'));
test('candidate lists only identifications/users, details include all five',()=>{
 for(const prefix of ['/api/v1','/mcp/v1']){
  assert.ok(doc.paths[prefix+'/domains/{domain_scope}/history/identifications']);
  assert.ok(doc.paths[prefix+'/domains/{domain_scope}/history/user']);
  for(const hidden of ['visitor','device','ip'])assert.equal(doc.paths[prefix+'/domains/{domain_scope}/history/'+hidden],undefined);
  const detail=doc.paths[prefix+'/domains/{domain_scope}/history/{resource}/{id}'].get;
  assert.deepEqual(detail.parameters.find(p=>p.name==='resource').schema.enum,['identifications','user','visitor','device','ip']);
 }
 assert.equal(Object.keys(doc.paths).some(p=>p.includes('/v1/history/')),false);
});
test('golden shapes and exact counts validate, utility fields and old envelope do not',()=>{
 for(const [name,file] of [['UserPage','user-page-all'],['IdentificationPage','identification-page'],['UserPage','empty-page'],['Error','snapshot-expired']]){
  const r=validate(name,fixture(file));assert.ok(r.ok,JSON.stringify(r.errors));
 }
 const all=fixture('user-page-all');assert.equal(all.data.length,2);assert.equal(all.data[0].id,all.data[1].id);assert.notEqual(all.data[0].domain_id,all.data[1].domain_id);
 all.data[0].source_tenant=42;assert.equal(validate('UserPage',all).ok,false);
 assert.equal(validate('UserPage',{data:[],total:0,offset:0}).ok,false);
 assert.equal(validate('UserPage',{data:[],next_page_token:null,total:9007199254740992}).ok,false);
});
test('atomic filter accepts browser-vpn independently and rejects grouped-only aliases',()=>{
 assert.ok(validate('Filter',{identification:{chips:[{dimension:'risk_signal',value:'browser_vpn_proxy'}]}}).ok);
 assert.equal(validate('Filter',{identification:{chips:[{dimension:'risk_signal',value:'banned_ip'}]}}).ok,false);
 assert.equal(validate('Filter',{domain:'a.test'}).ok,false);
 assert.equal(validate('Filter',{entity:{ids:null}}).ok,false);
});

test('all candidate schemas compile and references resolve',()=>{
 for(const name of Object.keys(doc.components.schemas))assert.equal(typeof ajv.compile({$ref:root.$id+'#/components/schemas/'+name}),'function');
});
