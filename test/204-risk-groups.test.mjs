import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import Ajv from 'ajv';

test('AI flags are additive and old detection payloads remain valid', () => {
 const schema = YAML.parse(readFileSync(new URL('../spec/components/schemas/DetectionFlags.yaml', import.meta.url), 'utf8'));
 const validate = new Ajv({strict:false}).compile(schema);
 const legacy = Object.fromEntries(schema.required.map(key => [key,false]));
 assert.equal(validate(legacy), true);
 assert.equal(validate({...legacy,ai_bot:true,ai_browser:false}), true);
 assert.equal(validate({...legacy,ai_bot:'true'}), false);
 assert.equal(schema.required.includes('ai_bot'), false);
 assert.equal(schema.required.includes('ai_browser'), false);
});
