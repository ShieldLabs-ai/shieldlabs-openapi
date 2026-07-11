# Contract drift: webhook payload

**Status: RESOLVED (2026-07-11).**

Upstream [`Shield.Docs/references/openapi.yaml`](https://github.com/ShieldLabs-ai/Shield.Docs/blob/main/references/openapi.yaml) webhook section now matches Shield.Core:

- Envelope: `event_type`, `schema_version: "2026-06-01"`, `created_at`, `data` (optional for ping)
- Events: `identification.scored`, `webhook.ping`
- Signature: header `X-Shield-Signature: sha256=<hex>` (not a body field)
- Scored data: `risk_score`, `signals[{name,weight}]`, `detection_flags` (19 booleans including `browser_automation` / `search_bot`), `public_ip` / `local_ip`, `traffic_source`, …

Source of truth: `Shield.Core/internal/entity/webhook.go`, `internal/provider/webhook/sender.go`, `internal/pipeline/stackhandler/adapter/webhook.go`.

This repo's `openapi.yaml` is a mirror of that upstream file. Code-accurate JSON Schema remains in [`webhooks/identification.scored.schema.json`](./webhooks/identification.scored.schema.json); see [`SIGNATURE.md`](./webhooks/SIGNATURE.md) for verification.

## Prod confirmation (A2)

Webhook contract `2026-06-01` is on `main` and deployed via Shield.Core Deploy workflow (confirmed successful production deploys through 2026-07-10).

## History ownership (A3) / lookup types (A4)

- History API (`account.shieldlabs.ai/api`): **Shield.Portal.Admin**, envelope `{ data, total }`
- Management History (`api.shieldlabs.ai/v1/history`): **Shield.Core**, PascalCase array
- Unified lookup types (both surfaces): `ip`, `user_hid`, `visitor_id`, `request_id`, `device_id`, `session_id`, `cookie_id`
