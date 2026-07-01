# Contract drift: webhook payload (must reconcile before public launch)

**Status: OPEN. Owner: founder / Core + Docs devs.**

The `openapi.yaml` in this repo is mirrored from `Shield.Docs/references/openapi.yaml` (the maintained source of truth). Its **webhook section is stale relative to the live `Shield.Core` code** on `development`. The non-webhook surface (History API, Management API, Profile, Snapshot, error responses) matches the code and needs no change.

## The mismatch

| Aspect | `openapi.yaml` (from Shield.Docs, v1.1) | Shield.Core code (`internal/entity/webhook.go`, `internal/provider/webhook/sender.go`) |
|---|---|---|
| Envelope | `{ Data, Assing }` | `{ event_type, schema_version: "2026-06-01", created_at, data }` |
| Field casing | PascalCase (`Score`, `Details[]`, `RequestID`) | snake_case (`risk_score`, `signals[]`, `request_id`) |
| Score field | `Score` (0-100) | `risk_score` (0-100) |
| Signals | `Details[]` of `{ Value, Description }` | `signals[]` of `{ name, weight }` |
| Detection flags | none | `detection_flags{}` (17 booleans) |
| Traffic source | none | `traffic_source{}` (channel + UTM set) |
| IPs | single `IP` | `public_ip{ip,country}`, `local_ip{ip,country}` |
| Phase | `Phase: initial \| update` | not present in the envelope |
| Signature | `Assing` field **in the body** | header `X-Shield-Signature: sha256=HMAC-SHA256(secret, raw_body)` |
| Event types | implicit | `identification.scored`, `webhook.ping` |

The code-accurate contract is captured in [`webhooks/identification.scored.schema.json`](./webhooks/identification.scored.schema.json) and [`webhooks/SIGNATURE.md`](./webhooks/SIGNATURE.md).

## Open questions to resolve

1. **Which contract is live in production?** The new contract is committed on `Shield.Core@development`. Confirm whether it is deployed to prod before anything is published.
2. **Update the docs.** Once confirmed, replace the `webhooks:` section (and `WebhookEnvelope` / `WebhookBody` schemas) in `Shield.Docs/references/openapi.yaml` with the new contract, and update `Shield.Docs/api/webhooks.mdx` and `setup/webhooks.mdx`.
3. **Then regenerate** this repo's `openapi.yaml` and the SDK types from the reconciled source of truth.

Until this is resolved, do **not** make `shieldlabs-openapi` public: the two contracts contradict each other.
