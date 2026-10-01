# Contributing

This repository is the contract of the public ShieldLabs API. Every change must describe what the
servers actually do: the spec, the examples and the tests change together.

## Setup

Node.js 20.19 or later.

```sh
npm ci
npm run lint && npm test
```

## Layout

| Path | What lives there |
|---|---|
| `spec/openapi.yaml` | Root: `info` (with the long description), servers, tags, and `$ref`s to paths, webhooks and security schemes |
| `spec/paths/*.yaml` | One path item per file: operation, parameters, responses |
| `spec/webhooks/*.yaml` | One webhook per file (`identification.scored`, `webhook.ping`) |
| `spec/components/schemas/` | Schemas; a file name becomes the component name (`HistoryRow.yaml` is `#/components/schemas/HistoryRow`) |
| `spec/components/{parameters,responses,headers,securitySchemes,examples}/` | Reusable components, named the same way |
| `spec/models/` | JSON-Schema-only entry points that are not HTTP payloads (the normalized `Identification`, the any-event union) |
| `test/fixtures/` | Copies of the shared SDK test fixtures |
| `dist/` | Generated. Never edit it by hand |
| `scripts/` | Build, lint, fixture sync and live check |
| `examples/` | Runnable scripts for users of the package (tested) |

Refer to other files with relative `$ref`s (`$ref: ../components/schemas/HistoryRow.yaml`). The
bundler turns each referenced file into a component named after the file.

## Edit the spec

1. Change the files under `spec/`. Keep descriptions in plain, technical English: colons or
   parentheses instead of dashes between clauses, "risk signals", the three risk bands (trusted
   0-29, suspicious 30-59, dangerous 60-100), English country names.
2. `npm run lint`. The Redocly configuration is strict: every problem is an error. The only
   accepted exception is listed in `.redocly.lint-ignore.yaml` (the Test delivery example lacks
   two flags by design); do not add others.
3. `npm run bundle` to regenerate `dist/`, then commit `spec/` and `dist/` together. CI fails when
   `dist/` does not match `spec/`.
4. `npm test`.

## Add or update examples

Examples of real payloads come from the shared SDK fixtures, never from invented data.

- Fixture-based examples are generated. To take new fixtures, run
  `npm run sync:fixtures -- --from <directory with the shared fixtures>`: it copies them into
  `test/fixtures/` and rewrites the generated files in `spec/components/examples/`. To add one,
  add an entry to `FIXTURE_EXAMPLES` in `scripts/lib/fixtures.mjs`, run `npm run sync:fixtures`
  and reference the new file from a path or webhook.
- Hand-written examples (small error strings, the health answer) live next to them without the
  "Generated" header. Use documentation IP ranges (192.0.2.0/24, 198.51.100.0/24,
  203.0.113.0/24), UUID v4 request IDs and placeholder keys such as `sec_your_private_key`.
- Every example must validate against its schema; the tests check this with Ajv.

## Checks before a pull request

```sh
npm ci && npm run lint && npm test && npm run bundle && git diff --exit-code dist/
```

Optionally run `SHIELDLABS_API_KEY=... npm run check:live` against a test domain.

Commit messages follow the conventional style (`feat:`, `fix:`, `docs:`, `test:`, `ci:`).

## Releases

Maintainers bump `version` in `package.json` and `info.version` in `spec/openapi.yaml` (a test
keeps them equal), run `npm run bundle`, add a `CHANGELOG.md` section and push a `v<version>`
tag. The release workflow then:

1. checks the tag against the version, runs lint, tests and the `dist/` freshness check, and
   packs the package (read-only token);
2. publishes the packed tarball to npm with provenance from the `npm` environment, using the
   `NPM_TOKEN` secret (add required reviewers to that environment to approve each release);
3. creates the GitHub release with the `dist/` files and the `CHANGELOG.md` section attached.

Every job can be re-run after a failure: a version that is already on npm is not published
again, and an existing GitHub release gets its files replaced.
