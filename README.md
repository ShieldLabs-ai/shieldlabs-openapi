# shieldlabs-openapi

Public OpenAPI specification for the ShieldLabs API. Source of truth for generating the client SDKs and the API reference docs.

> **Pre-launch.** Private until launch. The spec is mirrored from the internal docs and verified against the live code. There is one open contract drift to reconcile first — see [`DRIFT.md`](./DRIFT.md).

## Contents

- [`openapi.yaml`](./openapi.yaml) — the API spec (OpenAPI 3.1). Mirrored from the maintained internal docs spec. Covers:
  - **History API** (`account.shieldlabs.ai/api`) — snapshot reads with a Private API Key. Recommended, does not consume request balance.
  - **Management API** (`api.shieldlabs.ai`) — profile, balance, and a billed History path. Secret Key in headers (`X-Shield-Domain` + `Authorization: Bearer`); legacy path auth deprecated (sunset 2027-01-01).
- [`webhooks/identification.scored.schema.json`](./webhooks/identification.scored.schema.json) — JSON Schema for the outbound webhook, derived 1:1 from the live Shield.Core code (`schema_version 2026-06-01`).
- [`webhooks/example.identification.scored.json`](./webhooks/example.identification.scored.json) — a sample payload.
- [`webhooks/SIGNATURE.md`](./webhooks/SIGNATURE.md) — how to verify the `X-Shield-Signature` header.
- [`DRIFT.md`](./DRIFT.md) — the webhook contract mismatch between the docs spec and the code, and how to reconcile it.

## The three API surfaces

1. **JS snippet** posts collected signals to `rest.shieldlabs.ai` automatically. You never call this yourself.
2. **Webhooks** deliver the risk score and signals to your server shortly after a visit.
3. **Server API** (History + Management) for reading stored snapshots and account state.

The risk score is an integer from 0 to 100. ShieldLabs scores visits; your own code decides whether to allow, challenge, review, or block. You set the rules.

## License

[MIT](./LICENSE)
