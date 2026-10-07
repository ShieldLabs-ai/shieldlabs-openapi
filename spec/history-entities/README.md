# Entity History contract candidate (#202)

`openapi.json` is the first executable H1 contract candidate, version
2.0.0-alpha.1. It is not a description of a deployed API. It describes mandatory
Concrete UUID-only domain paths on public and MCP surfaces, identifications/user lists,
five entity detail types, opaque pagination, atomic filters and closed DTOs.

Fixtures in `test/history-entities/` are shared migration inputs for the four
server SDKs and hosted MCP tools. `npm test` validates them and checks disabled
list capabilities, utility field exclusion and atomic-only filter values.

The live 1.x `spec/openapi.yaml` and dist exports remain the pre-cutover
publication. H2 physical retained admin reads, exact field/relations parity,
H-10 public user auth and H5–H7 consumer/release gates must pass before replacing
those exports and releasing a new major. The old API is retired at that cutover;
no compatibility adapter or version negotiation is introduced.

See the authoritative target and execution gates:
https://github.com/ShieldLabs-ai/shield.ssot/tree/main/design/history-api

`all` is disabled on both surfaces for list/detail/relations (403 domain_scope_not_supported). Multi-domain support remains a future requirement in SSOT F1; existing multi-domain DTO fixtures describe future grain, not an enabled capability.
