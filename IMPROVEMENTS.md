# aemdm improvement backlog

Ideas for future work on the CLI. Prioritized roughly by impact and effort.

## Quick wins (bugs & polish)

### 1. Fix config path in help and `--skill`

Built-in help and `renderSkillText()` say config lives at `~/.aemdm/config.json`, but `resolveConfigPath()` uses XDG paths (`~/.config/aemdm/config.json`). README is correct; help and skill output are misleading for operators and LLMs.

### 2. Remove the self-dependency in `package.json`

`package.json` currently lists `"aemdm": "0.6.0"` under `dependencies`. That looks accidental and can confuse installs and audits.

### 3. Add a `config` subcommand

Today only `aemdm --bucket …` / `--ims-token …` writes config. Useful additions:

- `aemdm config path` — print resolved path
- `aemdm config show` — redact token (e.g. `***last4`)
- `aemdm config unset [--bucket|--ims-token]` — clear saved values

### 4. Persist `apiKey` in profile

Profile schema only stores `bucket` and `imsToken`. Search always needs an API key; saving it (like bucket) would match how people use the tool daily.

---

## Operator & scripting UX

### 5. Structured output for `asset get`

Search has `--json`; `asset get` only prints a bare URL or metadata JSON. A `--json` mode like `{ "url": "...", "assetId": "..." }` would make shell/CI pipelines more reliable than parsing a single line.

### 6. Search pagination helpers

`--cursor` and `--limit` exist, but there is no workflow for “get everything” or “next page”. Consider:

- `search --all` (loop until cursor exhausted, with a safety cap)
- `search --next-cursor` (print cursor only for scripting)
- stderr progress when `--verbose`

### 7. Avoid empty full-text when filtering only

`buildSearchRequest()` always adds a `FULLTEXT` clause with `text: options.text ?? ""`. Metadata-only searches still send an empty text match, which may be surprising or inefficient. Omit the match clause when `--text` is absent and at least one `--where` is present.

### 8. Batch / stdin workflows

Common pattern: many IDs from search or a file.

```bash
aemdm search --ids-only … | while read id; do aemdm asset get "$id" …; done
```

A first-class `asset get --stdin` or `aemdm batch url …` (read IDs, one URL per line) would reduce shell boilerplate and repeated bucket/auth resolution.

### 9. Shell completion

Commander supports completion generators; `aemdm completion bash|zsh|fish` would help with `--where`, formats, and asset IDs from recent history (optional).

---

## Reliability & diagnostics

### 10. `doctor` / connectivity check

A small command that:

- Resolves bucket from flag/env/profile
- Optionally HEADs a known public asset or POSTs a minimal search
- Prints clear guidance on 401/403/404

Especially helpful when bucket host, token expiry, or API key are wrong.

### 11. HTTP timeouts and retries

`request()` uses raw `fetch` with no timeout. For large binaries or flaky networks, configurable `--timeout` and limited retries on 502/503 would improve real-world use.

### 12. Richer HTTP errors

`HttpError` already includes the body. Map common cases:

- 401 → “IMS token expired or invalid”
- 403 → “check API key / asset activation”
- 404 → “asset ID or bucket mismatch”

### 13. Verbose mode depth

`-v` logs bucket and counts; in verbose mode, logging the search POST body (redacted token) and final URL would speed up “why did search return nothing?” debugging.

---

## Security

### 14. Token storage

Saving IMS tokens to plain JSON is convenient but risky on shared machines. Options:

- Document risk prominently
- Support `AEMDM_IMS_TOKEN` only (no profile write for token)
- Optional macOS Keychain / `pass` integration via env hook
- `config show` must never print full token

### 15. File permissions on write

After `writeProfileConfig()`, set mode `0600` on `config.json` so tokens are not world-readable.

---

## Feature gaps (API-aligned)

### 16. More delivery modifiers

If the OpenAPI spec supports crop, rotate, DPR, smart imaging, etc., expose them as flags (or a `--params key=value` escape hatch) to reduce hand-built URLs.

### 17. Search output modes

- `--count` — total hits only
- `--table-json` / `--ndjson` — one hit per line for `jq`
- `--fields` default set for table columns (today table columns are fixed)

### 18. `asset get` parity with search shortcuts

Search has `--first-url`, `--first-metadata`, `--first-binary`. For a known ID, aliases like `asset url` / `asset metadata` could shorten the mental model (optional; current `asset get` flags are fine).

### 19. MIME / route hints without extra round-trip

`--mime-type` and search-hit `dc:format` already exist. Extend with `--from-search-hit @file.json` or accepting a path to a prior `--json` hit so agents can chain commands without re-parsing fields manually.

---

## Codebase maintainability

### 20. Split `cli.ts`

`cli.ts` is ~800 lines. Natural modules:

- `commands/asset.ts`, `commands/search.ts`
- `schemas.ts` (Zod)
- `skill.ts` (static text)
- Keep `runCli` as thin orchestration

Libs already have good unit tests; splitting would make new commands cheaper.

### 21. Exit codes

Use `0` success, `1` runtime/API error, `2` validation/usage (POSIX-style). Helps scripts distinguish bad flags from HTTP failures.

### 22. Global flags on subcommands

`--verbose` is on the root program and propagates via `preAction`. A global `--profile production` (separate config files) would help multi-tenant operators.

---

## Documentation & LLM workflow

### 23. Align `--skill` with README

After fixing config paths, add:

- Exact config precedence
- When unauthenticated `asset get` works vs requires `--format` / `--original`
- Do not copy accidental `package.json` self-deps into examples

### 24. “Recipes” section

Short cookbook entries: “find hero image and download webp 1600w”, “pipe first ID to asset get with mime type”, “paginate all JPEGs with tag X”.

---

## Testing & release

### 25. Contract tests against API shapes

Integration tests mock `fetch` well. Optional: fixture JSON from real search responses so `getAssetIdFromHit` and table formatting stay stable if Adobe changes field names.

### 26. Pre-release smoke script

Document or script: `aemdm doctor --bucket $AEMDM_BUCKET` after release (fits the existing `/release` skill).

---

## Suggested priority

| Priority | Items |
|----------|--------|
| P0 | Fix config path in help/`--skill`; remove self-dependency |
| P1 | `config` subcommand; `config.json` mode `0600`; structured `--json` on `asset get` |
| P2 | Search: skip empty FULLTEXT; pagination helpers; `doctor` |
| P3 | Completions, batch stdin, timeouts/retries, split `cli.ts` |

---

## Notes

The CLI is already strong for its scope: clear Zod validation, LLM-oriented `--skill`, useful search output modes, and sensible auth/bucket resolution. The highest-impact improvements are correct config docs, safer token handling, and script-friendly output/pagination so humans and agents need less shell glue.
