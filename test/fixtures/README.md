# Shared fixtures

Verbatim copies of the shared ShieldLabs SDK test fixtures: the same files every official server
SDK tests against. Do not edit them here. Refresh them with
`npm run sync:fixtures -- --from <directory with the shared fixtures>`, which also regenerates
the fixture-based examples in `spec/components/examples/`.

| File | Checked against |
|---|---|
| `history-page.json`, `history-empty.json` | `HistoryPage` and `HistoryRow` |
| `webhook-identification-scored.json` (+ `.raw.txt`), `webhook-rate-limited.json` | `IdentificationScoredEvent` and the documented example signature |
| `webhook-ping.json` (+ `.raw.txt`) | `WebhookPingEvent` and the documented example signature |
| `webhook-test-delivery.json` | `IdentificationScoredEvent`: must fail on exactly the two missing flags |
| `management-profile.json` | `DomainProfile` |
| `normalization-cases.json` | inputs against `HistoryRow` / `IdentificationScoredData`, outputs against the `Identification` export |
| `error-responses.json` | the documented error responses of each API |
| `risk-band-cases.json` | `RiskScore` and the three risk bands |
| `webhook-signature-vectors.json` | the documented signature algorithm |
