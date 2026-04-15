import { describe, expect, test } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSearchRequest,
  loadRawQuery,
  normalizeSearchField,
  parseWhereClause,
} from "../src/lib/search.js";
import { normalizeBucket, resolveSearchAuth } from "../src/lib/client.js";
import {
  readProfileConfig,
  resolveConfigPath,
  writeProfileConfig,
} from "../src/lib/config.js";

describe("search helpers", () => {
  test("normalizes metadata field prefixes", () => {
    expect(normalizeSearchField("x:y")).toBe("assetMetadata.x:y");
    expect(normalizeSearchField("repositoryMetadata.repo:name")).toBe(
      "repositoryMetadata.repo:name",
    );
  });

  test("maps x:y=z to asset metadata term query", () => {
    expect(parseWhereClause("x:y=z")).toEqual({
      field: "assetMetadata.x:y",
      values: ["z"],
    });
  });

  test("builds AND-style search requests from repeated where clauses", () => {
    const request = buildSearchRequest({
      text: "shoe",
      where: ["x:y=z", "repositoryMetadata.dc:format=image/jpeg,image/png"],
      limit: 10,
    });

    expect(request).toEqual({
      query: [
        {
          match: {
            mode: "FULLTEXT",
            text: "shoe",
          },
        },
        {
          term: {
            "assetMetadata.x:y": ["z"],
          },
        },
        {
          term: {
            "repositoryMetadata.dc:format": ["image/jpeg", "image/png"],
          },
        },
      ],
      limit: 10,
    });
  });

  test("uses empty full-text query when only filters are present", () => {
    const request = buildSearchRequest({
      where: ["x:y=z"],
    });

    expect(request.query[0]).toEqual({
      match: {
        mode: "FULLTEXT",
        text: "",
      },
    });
  });

  test("loads raw query from inline JSON", async () => {
    const request = await loadRawQuery('{"query":[{"match":{"text":"hello"}}]}');
    expect(request).toEqual({
      query: [{ match: { text: "hello" } }],
    });
  });

  test("loads raw query from file", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aemdm-search-"));
    const filePath = path.join(tempDir, "query.json");
    await writeFile(filePath, '{"query":[{"match":{"text":"from-file"}}]}', "utf8");

    const request = await loadRawQuery(`@${filePath}`);
    expect(request).toEqual({
      query: [{ match: { text: "from-file" } }],
    });
  });
});

describe("client helpers", () => {
  test("normalizes bare bucket host into delivery base URL", () => {
    expect(normalizeBucket("delivery-p123-e456.adobeaemcloud.com")).toBe(
      "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets",
    );
  });

  test("normalizes full bucket URL into delivery base URL", () => {
    expect(normalizeBucket("https://delivery-p123-e456.adobeaemcloud.com")).toBe(
      "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets",
    );
  });

  test("requires search auth inputs", () => {
    expect(() => resolveSearchAuth(undefined, undefined, {})).toThrow(
      /Missing IMS token/,
    );
  });

  test("defaults the search api key", () => {
    expect(resolveSearchAuth("token", undefined, {})).toEqual({
      imsToken: "token",
      apiKey: "asset_search_service",
    });
  });

  test("writes and reads profile config", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aemdm-config-"));
    const env = {
      HOME: tempDir,
    } as NodeJS.ProcessEnv;

    const configPath = await writeProfileConfig(env, {
      bucket: "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets",
    });

    expect(configPath).toBe(resolveConfigPath(env));
    await expect(readProfileConfig(env)).resolves.toEqual({
      bucket: "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets",
    });
  });
});
