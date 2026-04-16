# `aemdm`

`aemdm` is a small TypeScript CLI for Adobe Dynamic Media with OpenAPI.

It is designed as a practical operator tool for both humans and LLM-driven workflows:

- Build Dynamic Media delivery URLs from a known asset ID.
- Fetch asset metadata JSON.
- Download transformed or original binaries.
- Search activated assets with simple exact-match metadata filters.
- Emit an LLM-oriented usage guide with `--skill`.
- Persist a default bucket in a local profile config so repeated commands stay short.

## Features

- Build asset delivery URLs by asset ID.
- Apply delivery modifiers such as `format`, `size`, `width`, `height`, `quality`, and `max-quality`.
- Fetch asset metadata.
- Download transformed or original binaries.
- Search activated assets with a simple metadata filter DSL.
- Pass through raw search JSON when you need the full API request body.
- Emit asset IDs in pipe-friendly forms for follow-up CLI calls.

## Install

Install globally from npm:

```bash
npm install -g aemdm
```

Or run directly with `npx`:

```bash
npx aemdm asset get urn:aaid:aem:1234 --bucket delivery-p123-e456.adobeaemcloud.com
```

## Usage

### URL by asset ID

```bash
npx aemdm asset get urn:aaid:aem:1234 \
  --bucket delivery-p123-e456.adobeaemcloud.com \
  --format webp \
  --size 1200x800 \
  --quality 75
```

### Metadata

```bash
npx aemdm asset get urn:aaid:aem:1234 --metadata
```

If an IMS token is available, `--metadata` returns the full metadata document from the metadata endpoint. Without authentication, it returns a smaller public JSON object based on the asset response headers:

```bash
npx aemdm asset get urn:aaid:aem:1234 --metadata --ims-token "$AEMDM_IMS_TOKEN"
```

### Original binary

```bash
npx aemdm asset get urn:aaid:aem:1234 \
  --original \
  --binary \
  --output ./asset.bin
```

Public assets can also be downloaded without passing a token:

```bash
npx aemdm asset get urn:aaid:aem:1234 --binary --output ./asset.bin
```

### Search

```bash
npx aemdm search \
  --where x:y=z \
  --where repositoryMetadata.dc:format=image/jpeg,image/png
```

### Search Output Modes

The default `search` output is a compact table for humans. For automation and piping, use one of these:

```bash
npx aemdm search --text "hero" --first-id
npx aemdm search --text "hero" --ids-only
npx aemdm search --text "hero" --json
```

These are useful when another command needs an asset ID:

```bash
aemdm search --where x:y=z --first-id
aemdm search --where x:y=z --ids-only | xargs -I {} aemdm asset get {}
```

If you want raw response automation with `jq`:

```bash
aemdm search --text "hero" --json | jq -r '.hits.results[0].assetId'
```

### LLM Skill Output

Use `--skill` to print a concise guide that explains what the tool does, which commands to use, and how an LLM should choose between them.

The skill output now also includes explicit search guardrails for agents, including that full-text search uses `--text` and that `aemdm search` does not support a `--query` flag.

```bash
npx aemdm --skill
```

Example output areas:

- tool purpose
- core commands
- asset and search examples
- metadata filter DSL behavior
- raw query examples
- LLM usage guidance for when to use `asset get`, `search`, `--first-url`, `--first-metadata`, and `--first-binary`

### Save a Default Bucket

You can save the bucket once and omit `--bucket` from later commands:

```bash
npx aemdm --bucket delivery-p123-e456.adobeaemcloud.com
```

After that, regular commands can use the saved profile bucket:

```bash
npx aemdm asset get urn:aaid:aem:1234
npx aemdm search --where x:y=z
```

### First result helpers

```bash
npx aemdm search --text "hero banner" --first-url --format webp --width 800
npx aemdm search --text "hero banner" --first-metadata
npx aemdm search --text "hero banner" --first-binary --output ./hero.bin
```

## Configuration

Resolution precedence is:

1. explicit flags
2. environment variables
3. saved profile config

Profile config path:

- `$AEMDM_CONFIG_PATH`, if set
- otherwise `$XDG_CONFIG_HOME/aemdm/config.json`
- otherwise `$HOME/.config/aemdm/config.json`

- `AEMDM_BUCKET`
- `AEMDM_IMS_TOKEN`
- `AEMDM_API_KEY` (defaults to `asset_search_service`)

## `--skill` Examples

These are especially useful when another tool or agent needs to understand how to call `aemdm`.

```bash
npx aemdm --skill
```

```bash
aemdm --skill
```

Typical LLM-oriented patterns:

```bash
aemdm --bucket delivery-p123-e456.adobeaemcloud.com
aemdm search --where x:y=z --first-id
aemdm search --text "hero" --ids-only
aemdm search --text "hero" --json
aemdm asset get urn:aaid:aem:1234 --format webp --size 1600x900 --quality 80
aemdm search --where x:y=z --first-url --format jpg --width 1200
aemdm search --raw-query @./query.json
```

## Publishing

The repository includes a `/release` skill for Claude Code that automates the full release process:

```
/release patch   # 0.2.1 → 0.2.2
/release minor   # 0.2.1 → 0.3.0
/release major   # 0.2.1 → 1.0.0
```

The skill bumps the version across all files, builds, tests, commits, pushes, creates a git tag, and creates a GitHub release.

Publishing to npm is triggered automatically when a GitHub release is created. The workflow uses npm trusted publishing (OIDC) via the `npm` GitHub environment — no token secret is needed.

The workflow verifies that the release tag matches the `version` field in `package.json`, runs `lint`, `build`, and `test`, and then publishes the package with provenance.

## References

- [Dynamic Media with OpenAPI spec](https://developer.adobe.com/experience-cloud/experience-manager-apis/api/stable/assets/delivery/)
- [Delivery APIs](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/dynamicmedia/dynamic-media-open-apis/deliver-assets-apis)
- [Search Assets API](https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/assets/dynamicmedia/dynamic-media-open-apis/search-assets-api)
