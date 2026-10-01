#!/usr/bin/env node
// Calls the live ShieldLabs API and validates the answers against dist/shieldlabs-api.json.
//
//   SHIELDLABS_API_KEY=sec_... npm run check:live
//
// Environment (keys are never printed):
//   SHIELDLABS_API_KEY              Private API Key. Without it the check is skipped.
//   SHIELDLABS_LIVE_REQUEST_ID      optional: a request ID of your domain whose row is validated
//   SHIELDLABS_SECRET_KEY           optional, with SHIELDLABS_DOMAIN: one Management API profile call
//   SHIELDLABS_DOMAIN               registered domain for the Management API
//   SHIELDLABS_API_BASE_URL         History API origin (default https://account.shieldlabs.ai)
//   SHIELDLABS_MANAGEMENT_BASE_URL  Management API origin (default https://api.shieldlabs.ai)
//
// Base URLs must use https; plain http is accepted only for localhost, 127.0.0.1 and [::1], so a
// typo never sends a key in cleartext.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isMain } from './lib/cli.mjs';
import { ROOT } from './lib/fixtures.mjs';
import { createValidator, describeErrors } from './lib/validator.mjs';

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'shieldlabs-openapi-check-live/1.0.0';

/** History API origin: no trailing slash and no trailing `/api` (paths start with /api/v1). */
export function historyOrigin(value) {
  let origin = (value || 'https://account.shieldlabs.ai').trim().replace(/\/+$/, '');
  if (origin.endsWith('/api')) origin = origin.slice(0, -'/api'.length);
  return origin;
}

/** Management API origin without a trailing slash. */
export function managementOrigin(value) {
  return (value || 'https://api.shieldlabs.ai').trim().replace(/\/+$/, '');
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Why a base URL must not receive a key, or null when it may: it has to parse, and it has to use
 * https unless it points at this machine.
 */
export function insecureBaseUrl(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    return 'is not a valid URL';
  }
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return null;
  return 'must use https (plain http is accepted only for localhost, 127.0.0.1 and [::1])';
}

/** The registered domain as the Management API matches it: lowercase host, no scheme, path or www. */
export function normalizeDomain(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^www\./, '');
}

async function getJson(url, headers) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT, ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  return { status: response.status, body, text };
}

function describeFailure(response) {
  const message = response.body && typeof response.body === 'object' ? response.body.error : undefined;
  return `HTTP ${response.status}${message ? ` (${message})` : ''}`;
}

const HEADER_SAFE = /^[\x21-\x7e]+$/;

/** Runs the live checks; returns an exit code. `print` receives one line per message. */
export async function runLiveChecks(env = process.env, print = console.log) {
  const apiKey = env.SHIELDLABS_API_KEY;
  const secrets = [apiKey, env.SHIELDLABS_SECRET_KEY].filter(Boolean);
  // Every line goes through here, so a key can never reach the output, even inside an error.
  const log = (line) => print(secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), line));
  if (!apiKey) {
    log('check:live skipped: set SHIELDLABS_API_KEY to call the live History API.');
    return 0;
  }
  if (!secrets.every((secret) => HEADER_SAFE.test(secret))) {
    log('FAIL  a key contains spaces or characters that are not allowed in an HTTP header');
    return 1;
  }
  const doc = JSON.parse(readFileSync(path.join(ROOT, 'dist', 'shieldlabs-api.json'), 'utf8'));
  const validator = createValidator(doc);
  const schema = (name) => ({ $ref: `#/components/schemas/${name}` });
  const history = historyOrigin(env.SHIELDLABS_API_BASE_URL);
  const management = managementOrigin(env.SHIELDLABS_MANAGEMENT_BASE_URL);
  for (const [name, origin] of [['SHIELDLABS_API_BASE_URL', history], ['SHIELDLABS_MANAGEMENT_BASE_URL', management]]) {
    const problem = insecureBaseUrl(origin);
    if (problem) {
      log(`FAIL  ${name} ${problem}`);
      return 1;
    }
  }
  const auth = { Authorization: `Bearer ${apiKey}` };
  let failures = 0;
  const pass = (message) => log(`ok    ${message}`);
  const fail = (message) => {
    failures += 1;
    log(`FAIL  ${message}`);
  };
  const check = (label, name, value) => {
    const result = validator.validate(schema(name), value);
    if (!result.valid) {
      fail(`${label} does not match ${name}: ${describeErrors(result.errors)}`);
      return false;
    }
    const { contentErrors } = validator.inspect(schema(name), value);
    if (contentErrors.length > 0) {
      fail(`${label}: ${contentErrors.join('; ')}`);
      return false;
    }
    return true;
  };

  try {
    const unknownId = randomUUID();
    const url = `${history}/api/v1/history/request_id/${unknownId}?limit=1`;
    const response = await getJson(url, auth);
    if (response.status !== 200) fail(`History API search for an unknown request ID: ${describeFailure(response)}`);
    else if (check('History API page', 'HistoryPage', response.body)) {
      if (response.body.total === 0 && response.body.data.length === 0) {
        pass('History API: an unknown request ID returns {"data":[],"total":0}');
      } else fail('History API: an unknown request ID returned rows');
    }

    const liveId = env.SHIELDLABS_LIVE_REQUEST_ID;
    if (liveId) {
      if (!UUID.test(liveId)) fail('SHIELDLABS_LIVE_REQUEST_ID is not a UUID');
      else {
        const rowUrl = `${history}/api/v1/history/request_id/${liveId.toLowerCase()}?limit=1`;
        const rowResponse = await getJson(rowUrl, auth);
        if (rowResponse.status !== 200) fail(`History API row: ${describeFailure(rowResponse)}`);
        else if (check('History API page', 'HistoryPage', rowResponse.body)) {
          if (rowResponse.body.data.length !== 1) fail('History API: SHIELDLABS_LIVE_REQUEST_ID matched no row');
          else if (check('History API row', 'HistoryRow', rowResponse.body.data[0])) {
            const { undocumented } = validator.inspect(schema('HistoryRow'), rowResponse.body.data[0]);
            pass(`History API: the row matches HistoryRow (${undocumented.length} undocumented diagnostic fields)`);
          }
        }
      }
    }

    const secret = env.SHIELDLABS_SECRET_KEY;
    const domain = env.SHIELDLABS_DOMAIN;
    if (secret && domain) {
      const profileUrl = `${management}/v1/profile`;
      const profile = await getJson(profileUrl, {
        'X-Shield-Domain': normalizeDomain(domain),
        Authorization: `Bearer ${secret}`,
      });
      if (profile.status === 429) fail('Management API: rate limited (a 10-minute block may be active; do not retry now)');
      else if (profile.status !== 200) fail(`Management API profile: ${describeFailure(profile)}`);
      else if (check('Management API profile', 'DomainProfile', profile.body)) pass('Management API: the profile matches DomainProfile');
    } else if (secret || domain) {
      log('note  set both SHIELDLABS_SECRET_KEY and SHIELDLABS_DOMAIN to check the Management API');
    }
  } catch (error) {
    fail(`request failed: ${error.name === 'TimeoutError' ? 'timeout' : error.message}`);
  }

  log(failures === 0 ? 'check:live passed' : `check:live failed (${failures} problem${failures === 1 ? '' : 's'})`);
  return failures === 0 ? 0 : 1;
}

if (isMain(import.meta.url)) {
  process.exitCode = await runLiveChecks();
}
