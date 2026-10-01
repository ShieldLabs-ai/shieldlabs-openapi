# ShieldLabs OpenAPI

The OpenAPI 3.1 description and JSON Schemas of the ShieldLabs API: History API, Management API, Health and webhooks.

[![CI](https://github.com/ShieldLabs-ai/shieldlabs-openapi/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldLabs-ai/shieldlabs-openapi/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm](https://img.shields.io/npm/v/@shieldlabs/openapi.svg)](https://www.npmjs.com/package/@shieldlabs/openapi)

## How it fits

1. **Browser.** The ShieldLabs agent runs an identification and hands your page a request ID. The browser never receives a Risk Score, a visitor ID or a device ID.
2. **Your backend.** It sends the request ID along with the protected action (signup, login, checkout) and reads the verdict from the **History API**, or receives it in a signed `identification.scored` **webhook**.
3. **Decision.** It acts on the Risk Score, the three risk bands, the detection flags and the identifiers, for example how many accounts one device has used.

This repository describes steps 2 and 3 exactly as they happen on the wire: every public endpoint, both webhook events, the error bodies the servers really send, and examples taken from the shared test fixtures of the official SDKs.

## Install

```sh
npm install @shieldlabs/openapi
```

Use `npm install --save-dev @shieldlabs/openapi` instead when you only generate code or validate payloads in tests. A webhook handler that validates events with the JSON Schemas at runtime needs the package as a regular dependency.

Or download the files you need:

| File | Contents |
|---|---|
| [`dist/shieldlabs-api.yaml`](./dist/shieldlabs-api.yaml) | The bundled OpenAPI 3.1 document |
| [`dist/shieldlabs-api.json`](./dist/shieldlabs-api.json) | The same document as JSON |
| [`dist/schemas/webhook-event.schema.json`](./dist/schemas/webhook-event.schema.json) | Any webhook delivery (unknown event types pass by their envelope) |
| [`dist/schemas/identification-scored-event.schema.json`](./dist/schemas/identification-scored-event.schema.json) | The `identification.scored` event |
| [`dist/schemas/webhook-ping-event.schema.json`](./dist/schemas/webhook-ping-event.schema.json) | The `webhook.ping` event |
| [`dist/schemas/history-page.schema.json`](./dist/schemas/history-page.schema.json) | A History API page (`{"data": [...], "total": N}`) |
| [`dist/schemas/history-row.schema.json`](./dist/schemas/history-row.schema.json) | One History API row |
| [`dist/schemas/identification.schema.json`](./dist/schemas/identification.schema.json) | The normalized `Identification` model the server SDKs return |

Stable download URLs:

- `https://cdn.jsdelivr.net/npm/@shieldlabs/openapi@1/dist/shieldlabs-api.yaml` (any file of the package, latest 1.x)
- `https://raw.githubusercontent.com/ShieldLabs-ai/shieldlabs-openapi/main/dist/shieldlabs-api.yaml`
- every [GitHub release](https://github.com/ShieldLabs-ai/shieldlabs-openapi/releases) attaches the `dist/` files

## Quick start

Load the document in Node.js 20.10 or later: save this as `index.mjs` next to your `node_modules` and run `node index.mjs`.

```js
import spec from '@shieldlabs/openapi' with { type: 'json' };
// CommonJS: const spec = require('@shieldlabs/openapi');

console.log(spec.info.version); // "1.0.0"
console.log(Object.keys(spec.paths)); // [ '/api/v1/history/{search_type}/{value}', ... ]
```

Read one verdict with `curl`:

```sh
curl "https://account.shieldlabs.ai/api/v1/history/request_id/02f1d973-84db-4156-a7f7-e799e6bf389b?limit=1" \
  -H "Authorization: Bearer $SHIELDLABS_API_KEY"
```

Open the rendered reference: serve the repository root and visit `/docs/`.

```sh
python3 -m http.server 8080
# http://localhost:8080/docs/
```

## Guide

### Use the official SDKs first

The server SDKs wrap this contract with typed models, History polling with backoff, webhook verification and risk helpers: [`@shieldlabs/node`](https://github.com/ShieldLabs-ai/shieldlabs-node), [`shieldlabs` for Python](https://github.com/ShieldLabs-ai/shieldlabs-python), [`shieldlabs-go`](https://github.com/ShieldLabs-ai/shieldlabs-go), [`shieldlabs/shieldlabs-php`](https://github.com/ShieldLabs-ai/shieldlabs-php), [`ai.shieldlabs:shieldlabs-java`](https://github.com/ShieldLabs-ai/shieldlabs-java) and [`ShieldLabs` for .NET](https://github.com/ShieldLabs-ai/shieldlabs-dotnet). Use this repository directly when you generate a client for another language, validate payloads in your own tests, or render the reference.

### Generate a client

Any generator that reads OpenAPI 3.1 can use `dist/shieldlabs-api.yaml`. For example, TypeScript types for every path, operation and schema:

```sh
npx openapi-typescript@7 node_modules/@shieldlabs/openapi/dist/shieldlabs-api.yaml -o shieldlabs-api.d.ts
```

Keep these points in mind with any generator:

- **Two hosts.** Every operation declares its own server: the History API on `https://account.shieldlabs.ai`, the Management API on `https://api.shieldlabs.ai`. Some generators only use the first root server; configure the base URL per API yourself in that case, and never give the History API a base URL ending in `/api` (the paths already start with `/api/v1/`).
- **Validate before sending.** The History API does not validate its path. An unknown `search_type` returns the latest identifications of the whole domain, and a malformed UUID or IPv4 value returns `500`. Restrict `search_type` to the seven values and check `value` first.
- **User HID in the path.** The History API matches a User HID only when the path uses one exact encoding: `A-Z a-z 0-9 - . _ ~ $ & + , : ; = @` unescaped, and every other byte of the UTF-8 value as uppercase `%XX` (including `! ' ( ) *`). Any other encoding is compared literally and returns an empty page. Many generated clients escape `$ & + , : ; = @` in path values, so build this path yourself for User HIDs that contain them. A User HID containing `/`, and the values `.` and `..`, cannot be searched. Hex-encoded hashes need no escaping.
- **Management credentials.** Send `X-Shield-Domain` (the registered domain, lowercase, without scheme or a leading `www.`) together with the Secret Key.
- **Open sets.** Signal names, operating systems, browsers, connection types, device types and the traffic fields are open sets: the descriptions list the known values (so does `x-extensible-enum` where the list is fixed today), and new values can appear. Parse unknown values instead of failing.

### Validate webhooks with the JSON Schemas

Install the package and the validator as regular dependencies:

```sh
npm install @shieldlabs/openapi ajv ajv-formats
```

Verify the signature over the raw body first, then parse, then validate (an ES module, for example `shieldlabs-webhook.mjs`):

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import schema from '@shieldlabs/openapi/schemas/webhook-event.schema.json' with { type: 'json' };

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validateEvent = ajv.compile(schema);

// rawBody: the exact bytes received (Buffer); secrets: current and, during a rotation, previous secret.
export function verifySignature(rawBody, header, secrets) {
  const match = String(header ?? '').trim().match(/^sha256=([0-9a-fA-F]{64})$/);
  if (!match) return false;
  const received = Buffer.from(match[1].toLowerCase(), 'hex');
  return secrets.some((secret) => {
    if (!secret) return false;
    const expected = createHmac('sha256', Buffer.from(secret, 'utf8')).update(rawBody).digest();
    return timingSafeEqual(expected, received);
  });
}

export function parseEvent(rawBody) {
  const event = JSON.parse(rawBody.toString('utf8'));
  if (!validateEvent(event)) console.warn('ShieldLabs event does not match the schema', validateEvent.errors);
  return event;
}
```

- The key is the whole signing secret, `whsec_` prefix included, as UTF-8 bytes. The message is the raw body: re-serialized JSON does not match (for example, `&` arrives as `\u0026`).
- Deliveries are made once per identification and endpoint, with a 1-second timeout and no retries today; a later release adds retries that resend identical bytes. Answer 2xx fast, make the handler idempotent on `data.request_id`, and use the History API for guaranteed reads.
- Log validation failures rather than rejecting the delivery. The analytics dashboard's Test button sends a sample whose `detection_flags` lack `browser_automation` and `search_bot`, so it fails the strict schema: treat missing flags as `false`.
- A History row can be refined after its webhook was sent; the webhook is not sent again. Read the History API when you need the latest state.

### Read identifications from the History API

- Search by `request_id` with `limit=1` right after a protected action. The row appears about 1-3 seconds after the browser call and can be refined for up to about 10 seconds as follow-up checks finish, so start the identification when the user begins the action (for example when the signup form opens). An empty `data` array means "not scored yet", never "clean": poll with backoff for up to about 10 seconds.
- Search by `device_id`, `user_hid`, `visitor_id` or `ip` for account-level checks. When you count accounts, skip rows whose `user_hid` is empty or one of `anonymous`, `fail`, `-1` and `unknown`: these do not identify a user.
- Page with `offset` while it is below `total`, and deduplicate on `request_id`.
- `score_details` is a JSON-encoded string; `created_at` is `YYYY-MM-DD HH:MM:SS.mmm` in UTC.

### Check the spec against the live API

```sh
SHIELDLABS_API_KEY=sec_your_private_key npm run check:live
```

The script searches for a random request ID and expects `{"data":[],"total":0}`. Optional variables: `SHIELDLABS_LIVE_REQUEST_ID` (validates that row), `SHIELDLABS_SECRET_KEY` with `SHIELDLABS_DOMAIN` (one Management API profile call), `SHIELDLABS_API_BASE_URL` and `SHIELDLABS_MANAGEMENT_BASE_URL` (https only; plain http is accepted for localhost, 127.0.0.1 and [::1]). It never prints keys and is skipped when `SHIELDLABS_API_KEY` is not set.

## Reference

### Operations

| operationId | Request | Credentials | Purpose |
|---|---|---|---|
| `searchHistory` | `GET https://account.shieldlabs.ai/api/v1/history/{search_type}/{value}` | Private API Key | Identifications matching one identifier, newest first |
| `getDomainProfile` | `GET https://api.shieldlabs.ai/v1/profile` | Secret Key + `X-Shield-Domain` | Domain, remaining included identifications, masked keys |
| `searchHistoryDeprecated` | `GET https://api.shieldlabs.ai/v1/history/{type}/{value}` | Secret Key + `X-Shield-Domain` | Deprecated, stops working after Sat, 01 Jan 2027 00:00:00 GMT |
| `getHealth` | `GET /health` on both hosts | none | Liveness |

### Webhooks

| Event | operationId | When |
|---|---|---|
| `identification.scored` | `identificationScored` | Once per identification and endpoint, when scoring is final |
| `webhook.ping` | `webhookPing` | When you verify an endpoint in the analytics dashboard |

Header: `X-Shield-Signature: sha256=<lowercase hex HMAC-SHA256(key = signing secret, message = raw body)>`.

### Package exports

| Import | File |
|---|---|
| `@shieldlabs/openapi` | `dist/shieldlabs-api.json` |
| `@shieldlabs/openapi/shieldlabs-api.json`, `@shieldlabs/openapi/shieldlabs-api.yaml` | the bundle |
| `@shieldlabs/openapi/schemas/<name>.schema.json` | `dist/schemas/<name>.schema.json` |
| `@shieldlabs/openapi/spec/...` | the split sources |

### Risk Score and risk bands

The Risk Score is an integer from 0 to 100; bands are computed on your side: trusted 0-29, suspicious 30-59, dangerous 60-100. A value above 100 is the rate-limit marker (999), never a score. The marker is written once, when the visitor's IP goes over the limit; request IDs issued while that IP stays blocked get no row at all, so treat them as unverified. Branch on the detection flags and the score; risk signal names are for display and logging, and their weights can be negative, so never add them up yourself.

## Errors and retries

| API | Status | Body | Retry |
|---|---|---|---|
| History | 401 | JSON text `{"error":"..."}` sent as `text/plain` | no |
| History | 429 | `{"error":"too many requests"}` (about 15 requests per second per domain) | yes, after about a second |
| History | 500 | `{"error":"..."}` as JSON, or JSON text for a failed key lookup | yes, unless caused by a malformed UUID or IPv4 value |
| Management | 400 | a bare JSON string or `null` (deprecated history endpoint) | no |
| Management | 401 | empty | no |
| Management | 429 | `{"error":"too many requests"}` (15 requests per minute per IP, then a 10-minute block) | **no**: wait, and cache the profile |
| Management | 503 | `{"error":"server is busy"}` | yes, with backoff |
| Both | 404 | `404 page not found` as `text/plain` | no |
| Both | 502, 504 | HTML from the edge proxy | yes, with backoff |

Branch on the status first, then try to parse the body as JSON whatever its content type.

## Compatibility

- OpenAPI 3.1.0; the JSON Schemas use JSON Schema 2020-12 and compile with a strict validator.
- `info.version` follows the package version (semantic versioning). Webhook payloads carry `schema_version` (`2026-06-01` today).
- Parse tolerantly: ignore unknown fields, keep unknown values of string fields and accept other `schema_version` values. Response fields with a known set of values are open strings in the spec and in the JSON Schemas, so a value added later never fails validation.
- Tooling requires Node.js 20.19 or later; CI runs on Node.js 20, 22 and 24.

## Development

```sh
npm ci
npm run lint     # Redocly, strict configuration
npm test         # bundle freshness, examples, fixtures, exports, tooling
npm run bundle   # rebuild dist/ after editing spec/
```

Runnable scripts that use the published files live in [`examples/`](./examples/README.md): listing
every operation with its server, and verifying plus validating a webhook delivery. See
[CONTRIBUTING.md](./CONTRIBUTING.md) for the layout of `spec/` and how to add examples.

Documentation: https://docs.shieldlabs.ai · Analytics dashboard (Start free): https://app.shieldlabs.ai · Support: contact@shieldlabs.ai

## License

[MIT](./LICENSE) © 2026 ShieldLabs Inc.
