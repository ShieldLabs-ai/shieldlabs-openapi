// Package layout, JSON Schema exports, the docs page, the live check script and the examples.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { describe, it } from 'node:test';
import { historyOrigin, insecureBaseUrl, managementOrigin, normalizeDomain } from '../scripts/check-live.mjs';
import { readFixture } from '../scripts/lib/fixtures.mjs';
import { SCHEMA_EXPORTS, SCHEMA_ID_BASE } from '../scripts/lib/json-schema.mjs';
import { createAjv } from '../scripts/lib/validator.mjs';
import { ROOT } from './helpers.mjs';

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function runCheckLive(env) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SHIELDLABS_')));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts', 'check-live.mjs')], {
      cwd: ROOT,
      env: { ...clean, ...env },
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

/** A local stand-in for both APIs that serves the shared fixtures. */
async function startMockApi({ corruptRow = false } = {}) {
  const liveId = '02f1d973-84db-4156-a7f7-e799e6bf389b';
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(`${JSON.stringify(body)}\n`);
    };
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/v1/history/request_id/')) {
      if (req.headers.authorization !== 'Bearer sec_test0000-test0000-test0000') {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('{"error":"invalid api key"}\n');
        return;
      }
      const id = url.pathname.split('/').pop();
      if (id !== liveId) return json(200, { data: [], total: 0 });
      const row = structuredClone(readFixture('history-page.json').data[0]);
      if (corruptRow) delete row.score;
      return json(200, { data: [row], total: 1 });
    }
    if (url.pathname === '/v1/profile') {
      if (req.headers['x-shield-domain'] !== 'example.com' || req.headers.authorization !== 'Bearer secret0000') {
        res.writeHead(401);
        res.end();
        return;
      }
      return json(200, readFixture('management-profile.json'));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 page not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, liveId, seen, close: () => new Promise((resolve) => server.close(resolve)) };
}

describe('check:live', () => {
  it('skips without SHIELDLABS_API_KEY', async () => {
    const { code, output } = await runCheckLive({});
    assert.equal(code, 0);
    assert.match(output, /skipped/);
  });

  it('validates History and Management answers and never prints the keys', async () => {
    const api = await startMockApi();
    try {
      const { code, output } = await runCheckLive({
        SHIELDLABS_API_KEY: 'sec_test0000-test0000-test0000',
        SHIELDLABS_API_BASE_URL: `${api.origin}/api/`,
        SHIELDLABS_LIVE_REQUEST_ID: api.liveId.toUpperCase(),
        SHIELDLABS_SECRET_KEY: 'secret0000',
        SHIELDLABS_DOMAIN: 'https://www.Example.com/',
        SHIELDLABS_MANAGEMENT_BASE_URL: api.origin,
      });
      assert.equal(code, 0, output);
      assert.match(output, /check:live passed/);
      assert.equal((output.match(/^ok {4}/gm) ?? []).length, 3, output);
      assert.ok(!output.includes('sec_test0000') && !output.includes('secret0000'), 'a key was printed');
      assert.equal(api.seen.length, 3, 'one call per check');
      assert.ok(api.seen.every((call) => !call.url.includes('/api/api/')));
      assert.equal(api.seen[2].headers['x-shield-domain'], 'example.com');
    } finally {
      await api.close();
    }
  });

  it('fails when an answer does not match the spec', async () => {
    const api = await startMockApi({ corruptRow: true });
    try {
      const { code, output } = await runCheckLive({
        SHIELDLABS_API_KEY: 'sec_test0000-test0000-test0000',
        SHIELDLABS_API_BASE_URL: api.origin,
        SHIELDLABS_LIVE_REQUEST_ID: api.liveId,
      });
      assert.equal(code, 1, output);
      assert.match(output, /must have required property 'score'/);
    } finally {
      await api.close();
    }
  });

  it('fails on a wrong key without printing it', async () => {
    const api = await startMockApi();
    try {
      const { code, output } = await runCheckLive({
        SHIELDLABS_API_KEY: 'sec_wrong000-wrong000-wrong000',
        SHIELDLABS_API_BASE_URL: api.origin,
      });
      assert.equal(code, 1, output);
      assert.match(output, /HTTP 401/);
      assert.ok(!output.includes('sec_wrong000'), 'the key was printed');
    } finally {
      await api.close();
    }
  });

  it('normalizes base URLs and the domain', () => {
    assert.equal(historyOrigin(undefined), 'https://account.shieldlabs.ai');
    assert.equal(historyOrigin('https://account.shieldlabs.ai/api/'), 'https://account.shieldlabs.ai');
    assert.equal(managementOrigin('https://api.shieldlabs.ai/'), 'https://api.shieldlabs.ai');
    assert.equal(normalizeDomain(' https://www.Example.com/signup?x=1 '), 'example.com');
    assert.equal(normalizeDomain('shop.example.com'), 'shop.example.com');
  });

  it('sends keys over https only, except to this machine', () => {
    for (const origin of ['https://account.shieldlabs.ai', 'http://localhost:8080', 'http://127.0.0.1:3000', 'http://[::1]:3000']) {
      assert.equal(insecureBaseUrl(origin), null, origin);
    }
    for (const origin of ['http://account.shieldlabs.ai', 'http://192.0.2.10', 'ftp://example.com', 'account.shieldlabs.ai']) {
      assert.ok(insecureBaseUrl(origin), origin);
    }
  });

  it('refuses a plain http base URL for a remote host before sending anything', async () => {
    for (const name of ['SHIELDLABS_API_BASE_URL', 'SHIELDLABS_MANAGEMENT_BASE_URL']) {
      const { code, output } = await runCheckLive({
        SHIELDLABS_API_KEY: 'sec_test0000-test0000-test0000',
        [name]: 'http://account.shieldlabs.example',
      });
      assert.equal(code, 1, output);
      assert.match(output, new RegExp(`FAIL  ${name} must use https`));
      assert.ok(!output.includes('sec_test0000'), 'the key was printed');
    }
  });
});

describe('examples', () => {
  function runExample(name, args = [], env = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'examples', name, 'index.mjs'), ...args], {
        cwd: ROOT,
        env: { ...process.env, NODE_NO_WARNINGS: '1', ...env },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });
  }

  it('node-list-operations prints every operation with its server', async () => {
    const { code, stdout } = await runExample('node-list-operations');
    assert.equal(code, 0);
    assert.match(stdout, /GET https:\/\/account\.shieldlabs\.ai\/api\/v1\/history\/\{search_type\}\/\{value\}/);
    assert.match(stdout, /GET https:\/\/api\.shieldlabs\.ai\/v1\/profile/);
    assert.match(stdout, /searchHistoryDeprecated \(deprecated\)/);
    assert.match(stdout, /event_type: webhook\.ping/);
  });

  it('node-validate-webhook verifies and validates the sample delivery', async () => {
    const { code, stdout } = await runExample('node-validate-webhook');
    assert.equal(code, 0);
    assert.match(stdout, /signature: valid/);
    assert.match(stdout, /schema: valid \(identification\.scored, schema_version 2026-06-01\)/);
    assert.match(stdout, /risk_score: 80 \(dangerous\)/);
  });

  it('node-validate-webhook rejects a wrong secret', async () => {
    const body = path.join(ROOT, 'test', 'fixtures', 'webhook-ping.raw.txt');
    const header = 'sha256=ea2685733d254f7028fb031c4214583b0650de01e6c8c93131236024edd9fdd8';
    const good = await runExample('node-validate-webhook', [body, header], {
      SHIELDLABS_WEBHOOK_SECRET: 'whsec_old_secret_value_0000000000, whsec_00112233445566778899aabbccddeeff',
    });
    assert.equal(good.code, 0, good.stderr);
    assert.match(good.stdout, /schema: valid \(webhook\.ping/);
    const bad = await runExample('node-validate-webhook', [body, header], {
      SHIELDLABS_WEBHOOK_SECRET: 'whsec_your_signing_secret',
    });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /signature: INVALID/);
  });
});

describe('package', () => {
  it('is @shieldlabs/openapi 1.0.0 and ships dist/ and spec/', () => {
    assert.equal(pkg.name, '@shieldlabs/openapi');
    assert.equal(pkg.version, '1.0.0');
    assert.equal(pkg.license, 'MIT');
    assert.ok(pkg.files.includes('dist/'));
    assert.ok(pkg.files.includes('spec/'));
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['bundle', 'check:live', 'lint', 'sync:fixtures', 'test']);
  });

  it('exports point at files that exist', () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (target.includes('*')) {
        const dir = path.join(ROOT, target.slice(0, target.indexOf('*')));
        assert.ok(existsSync(dir) && statSync(dir).isDirectory(), `${subpath} -> ${target}`);
      } else {
        assert.ok(existsSync(path.join(ROOT, target)), `${subpath} -> ${target}`);
      }
    }
    assert.ok(existsSync(path.join(ROOT, pkg.main)));
  });
});

describe('JSON Schema exports', () => {
  it('are self-contained JSON Schema 2020-12 documents that compile in strict mode', () => {
    const files = readdirSync(path.join(ROOT, 'dist', 'schemas')).sort();
    assert.deepEqual(files, SCHEMA_EXPORTS.map((e) => e.file).sort());
    for (const file of files) {
      const schema = JSON.parse(readFileSync(path.join(ROOT, 'dist', 'schemas', file), 'utf8'));
      assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', file);
      assert.equal(schema.$id, `${SCHEMA_ID_BASE}${file}`, file);
      assert.ok(schema.title && schema.description, file);
      assert.doesNotThrow(() => createAjv().compile(schema), file);
      const text = JSON.stringify(schema);
      assert.ok(!text.includes('"x-'), `${file} keeps an OpenAPI extension`);
      assert.ok(!/"\$ref":"(?!#)/.test(text), `${file} has an external $ref`);
    }
  });
});

describe('docs page', () => {
  it('renders dist/shieldlabs-api.json with a pinned renderer from a CDN', () => {
    const html = readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8');
    assert.match(html, /Redoc\.init\(\s*'\.\.\/dist\/shieldlabs-api\.json'/);
    assert.ok(existsSync(path.join(ROOT, 'dist', 'shieldlabs-api.json')));
    const script = html.match(/<script\s+src="([^"]+)"\s+integrity="([^"]+)"/);
    assert.ok(script, 'the renderer script needs an integrity hash');
    assert.match(script[1], /^https:\/\/cdn\.jsdelivr\.net\/npm\/redoc@\d+\.\d+\.\d+\//);
    assert.match(script[2], /^sha384-/);
  });
});
