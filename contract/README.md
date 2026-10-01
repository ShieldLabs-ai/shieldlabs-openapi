# Shared contract

The test fixtures every official ShieldLabs server SDK passes: real response and webhook bodies,
signature vectors, error bodies and the exact normalized results each SDK must produce. This
directory is their single source. The SDK repositories copy the files they use with
`scripts/sync_contract.py`; nobody edits a copy by hand.

Identifiers are synthetic UUIDs, IP addresses come from the documentation ranges (192.0.2.0/24,
198.51.100.0/24, 203.0.113.0/24), and the webhook secrets are test values.

## Files

| File | Content |
|---|---|
| `history-page.json` | A History API `200` body: five rows out of 37 matches (a dangerous paid click through a proxy with an anti-detect browser, a trusted anonymous visit, a VPN visit with a local network leak and a late network correction, the 999 rate-limit marker, a search-engine crawler) |
| `history-empty.json` | A History API `200` body with no match |
| `normalization-cases.json` | History rows and webhook `data` objects, each with the exact normalized `Identification` an SDK must produce. Compare `observed_at` at millisecond precision (truncate, never round); keys missing from `expected` (such as `raw`) are free |
| `signal-slug-cases.json` | History `score_details` descriptions and the signal slug each maps to (`signals[].name` in webhooks) |
| `risk-band-cases.json` | Risk Scores and their bands (`trusted`, `suspicious`, `dangerous`, and `rate_limited` for 999) |
| `webhook-identification-scored.json` | An `identification.scored` delivery, pretty printed |
| `webhook-identification-scored.raw.txt` | The same delivery as the exact bytes sent (compact, `&` escaped as `\u0026`, no trailing newline) |
| `webhook-rate-limited.json` | An `identification.scored` delivery carrying the 999 rate-limit marker |
| `webhook-ping.json`, `webhook-ping.raw.txt` | The `webhook.ping` sent when an endpoint is verified, pretty printed and as the exact bytes sent |
| `webhook-test-delivery.json` | The Test delivery from the analytics dashboard: 17 of the 19 detection flags and second-precision timestamps. Parsers must read the missing flags as `false` |
| `webhook-signature-vectors.json` | 21 `X-Shield-Signature` vectors: `body_base64` holds the exact bytes, `secret` or a `secrets` list (valid when any matches), `signature_header` and the expected `valid` |
| `management-profile.json` | A Management API `GET /v1/profile` body |
| `management-profile-expected.json` | The normalized domain profile an SDK returns for it |
| `error-responses.json` | Error bodies exactly as each API sends them, per status, with the expected error class and whether the SDK retries |
| `manifest.json` | `contract_version` (the spec version, `info.version`) and the SHA-256 of every file above |

The signatures in `webhook-signature-vectors.json` and the `X-Shield-Signature` examples in the
spec use the test secret `whsec_00112233445566778899aabbccddeeff`.

## How the SDKs use it

Each SDK repository has:

- `contract-sync.json`: the files it uses and where they go, for example
  `{"source": "shieldlabs-openapi", "files": {"normalization-cases.json": "tests/data/normalization-cases.json"}}`;
- `.shieldlabs-contract.lock`: the release it synced (`ref`), its `contract_version` and the
  SHA-256 of each file;
- `scripts/sync_contract.py`: an identical copy of the script in this repository.

`python3 scripts/sync_contract.py --check` runs in each SDK's CI without network access and fails
when a committed file no longer matches the lock. A scheduled workflow (`contract-sync.yml`, daily
and on demand) runs `python3 scripts/sync_contract.py --ref latest`: it finds the newest `vX.Y.Z`
tag of this repository, downloads `contract/manifest.json` and the mapped files from
`raw.githubusercontent.com` at that tag, refuses any file whose SHA-256 differs from the manifest,
then writes the files and the lock. When something changed, the workflow runs the SDK's full test
suite and opens a pull request with the result; failing tests add the
`contract-change-needs-code` label.

## Change the contract

1. Edit the files here. Keep them byte-exact: no reformatting, and no trailing newline in the
   `.raw.txt` files. A changed webhook body needs new signatures in
   `webhook-signature-vectors.json` and in `spec/components/parameters/ShieldSignature.yaml`.
2. `npm run sync:fixtures` regenerates the spec examples built from these files.
3. `python3 scripts/contract_manifest.py --write` refreshes `manifest.json`.
4. `npm test` and `python3 -m unittest discover -s scripts/tests`.

Release it as described in [CONTRIBUTING.md](../CONTRIBUTING.md#releases): every release tag
publishes the contract of that commit.
