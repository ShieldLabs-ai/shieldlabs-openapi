# Examples

Small Node.js scripts that use the published files. Run them from the repository root after
`npm ci` (they use the development dependencies `ajv` and `ajv-formats`).

| Example | What it shows |
|---|---|
| [`node-list-operations`](./node-list-operations/index.mjs) | Loads `@shieldlabs-ai/openapi` and prints every operation with the server it must be sent to |
| [`node-validate-webhook`](./node-validate-webhook/index.mjs) | Verifies `X-Shield-Signature` over the raw body, then validates the event with `dist/schemas/webhook-event.schema.json` |

```sh
node examples/node-list-operations/index.mjs

# the sample delivery stored in this repository
node examples/node-validate-webhook/index.mjs

# your own delivery: the raw body as received and the header value
SHIELDLABS_WEBHOOK_SECRET=whsec_your_signing_secret \
  node examples/node-validate-webhook/index.mjs body.json "sha256=..."
```

In a real handler, verify the signature before parsing and answer 2xx within a second. Each
identification is delivered once today (1-second timeout, no retries); a later release adds
retries that resend identical bytes, so make the handler idempotent on `data.request_id`, and use
the History API for guaranteed reads. The official server SDKs do all of this for you.
