# Contract drift: webhook payload (must reconcile before public launch)

**Status: OPEN. Owner: Vasili (webhook contract is his area — do not edit `Shield.Docs/references/openapi.yaml` without coordinating).**

The `openapi.yaml` in this repo is a faithful mirror of `Shield.Docs/references/openapi.yaml`. That upstream file's **webhook section is the one stale artifact**: the v2026-06-01 contract sweep on 2026-06-30 updated the live `Shield.Core` code **and** the Shield.Docs MDX pages (`setup/webhooks.mdx`, `api/webhooks.mdx`) to the new contract, but **missed `references/openapi.yaml`** — it still shows the old `{ Data, Assing }` PascalCase envelope.

So the correct contract already exists in three places (code, MDX docs, and [`webhooks/identification.scored.schema.json`](./webhooks/identification.scored.schema.json) here); only the upstream OpenAPI file lags. The non-webhook surface of `openapi.yaml` (History API, Management API, Profile, Snapshot, error responses) matches the code and needs no change.

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

## To resolve

1. **Fix upstream (Vasili).** In `Shield.Docs/references/openapi.yaml`, replace the `webhooks:` section and the `WebhookEnvelope` / `WebhookBody` / `ScoreDetail` schemas with the v2026-06-01 contract already reflected in the MDX docs and in [`webhooks/identification.scored.schema.json`](./webhooks/identification.scored.schema.json). The MDX pages are already correct and can be used as the reference.
2. **Re-mirror.** Once the upstream file is fixed, re-copy it into this repo's `openapi.yaml`.
3. **Then generate** the SDK types and API reference from the reconciled spec.

Until step 1 is done, do **not** make `shieldlabs-openapi` public: `openapi.yaml`'s webhook section still contradicts the live contract.
