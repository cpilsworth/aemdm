---
name: release
description: Bump the version, commit, push, and create a GitHub release that triggers npm publish via trusted publishing.
argument-hint: "<major|minor|patch>"
allowed-tools: Bash(git *) Bash(npm run *) Bash(npm test *) Bash(gh *) Read Edit Grep Glob
---

# Release

Create a new release of the aemdm package.

## Arguments

`$ARGUMENTS` must be one of: `major`, `minor`, or `patch`. This determines which part of the semver version to bump.

## Steps

1. **Ensure clean working tree**
   ```bash
   git status --short
   ```
   If there are uncommitted changes, stop and ask the user to commit or stash first.

2. **Read the current version** from `package.json`.

3. **Compute the new version** by bumping the `$ARGUMENTS` component of the current semver version.

4. **Update the version** in all places:
   - `package.json` — the `version` field
   - `src/cli.ts` — the `.version("x.y.z")` call
   - `README.md` — any `vX.Y.Z` tag references

5. **Build and test**
   ```bash
   npm run build
   npm test
   ```
   If either fails, stop and report the error.

6. **Commit and push**
   - Stage only the changed files (`package.json`, `src/cli.ts`, `README.md`)
   - Commit with message: `Bump version to X.Y.Z`
   - Push to the current branch

7. **Tag and create GitHub release**
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
   Then create a GitHub release:
   ```bash
   gh release create vX.Y.Z --title "vX.Y.Z" --generate-notes
   ```
   The release triggers the `publish.yml` workflow which publishes to npm via trusted publishing.

8. **Report the release URL** and remind the user to check the publish workflow status with `gh run list`.
