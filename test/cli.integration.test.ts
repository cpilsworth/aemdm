import { describe, expect, test, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "../src/cli.js";

class MemoryStream {
  private chunks: string[] = [];

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }

  toString(): string {
    return this.chunks.join("");
  }
}

describe("cli integration", () => {
  const env = {
    AEMDM_BUCKET: "delivery-p123-e456.adobeaemcloud.com",
    AEMDM_IMS_TOKEN: "test-token",
    AEMDM_API_KEY: "test-api-key",
  };

  test("prints URL by asset ID", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(["asset", "get", "urn:aaid:aem:1234"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe(
      "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets/urn%3Aaaid%3Aaem%3A1234",
    );
    expect(stderr.toString()).toBe("");
  });

  test("prints skill guidance for LLM usage", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(["--skill"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Purpose:");
    expect(stdout.toString()).toContain("aemdm asset get <assetId>");
    expect(stdout.toString()).toContain("LLM usage guidance:");
    expect(stderr.toString()).toBe("");
  });

  test("prints help with a zero exit code", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();

    const exitCode = await runCli(["--help"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Usage: aemdm");
    expect(stderr.toString()).toBe("");
  });

  test("saves bucket to profile config when provided alone", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aemdm-home-"));

    const exitCode = await runCli(["--bucket", "delivery-p123-e456.adobeaemcloud.com"], {
      env: { HOME: tempDir },
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain("Saved bucket to profile config");
    expect(stderr.toString()).toBe("");
  });

  test("uses saved profile bucket when no flag or env bucket is provided", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aemdm-home-"));

    await runCli(["--bucket", "delivery-p123-e456.adobeaemcloud.com"], {
      env: { HOME: tempDir },
      stdout: new MemoryStream() as never,
      stderr: new MemoryStream() as never,
      fetchImpl: vi.fn(),
    });

    const exitCode = await runCli(["asset", "get", "urn:aaid:aem:1234"], {
      env: {
        HOME: tempDir,
        AEMDM_IMS_TOKEN: "test-token",
        AEMDM_API_KEY: "test-api-key",
      },
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe(
      "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets/urn%3Aaaid%3Aaem%3A1234",
    );
  });

  test("prints metadata by asset ID", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assetId: "urn:aaid:aem:1234", ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const exitCode = await runCli(["asset", "get", "urn:aaid:aem:1234", "--metadata"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain('"ok": true');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("prints basic public metadata by asset ID when no token is provided", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "Content-Type": "image/webp",
          "Content-Length": "12345",
          "ETag": "\"asset-etag\"",
          "Cache-Control": "max-age=600",
        },
      }),
    );

    const exitCode = await runCli(["asset", "get", "urn:aaid:aem:1234", "--metadata"], {
      env: {
        AEMDM_BUCKET: "delivery-p123-e456.adobeaemcloud.com",
      },
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain('"mode": "basic"');
    expect(stdout.toString()).toContain('"auth": "public"');
    expect(stdout.toString()).toContain('"contentType": "image/webp"');
    expect(stdout.toString()).toContain('"contentLength": 12345');
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets/urn%3Aaaid%3Aaem%3A1234",
      { method: "HEAD" },
    );
    expect(stderr.toString()).toBe("");
  });

  test("downloads a public asset without a token", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aemdm-public-binary-"));
    const outputPath = path.join(tempDir, "asset.bin");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("public-bytes", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    const exitCode = await runCli(
      ["asset", "get", "urn:aaid:aem:1234", "--binary", "--output", outputPath],
      {
        env: {
          AEMDM_BUCKET: "delivery-p123-e456.adobeaemcloud.com",
        },
        stdout: stdout as never,
        stderr: stderr as never,
        fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(await readFile(outputPath, "utf8")).toBe("public-bytes");
  });

  test("downloads original binary to a file", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "aemdm-binary-"));
    const outputPath = path.join(tempDir, "asset.bin");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("asset-bytes", {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    const exitCode = await runCli(
      [
        "asset",
        "get",
        "urn:aaid:aem:1234",
        "--original",
        "--binary",
        "--output",
        outputPath,
      ],
      {
        env,
        stdout: stdout as never,
        stderr: stderr as never,
        fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(await readFile(outputPath, "utf8")).toBe("asset-bytes");
  });

  test("searches by metadata and resolves first result to a URL", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            results: [
              {
                assetId: "urn:aaid:aem:abcd",
                repositoryMetadata: {
                  "repo:name": "hero.jpg",
                  "dc:format": "image/jpeg",
                },
                assetMetadata: {
                  "dc:title": "Hero",
                },
              },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const exitCode = await runCli(
      [
        "search",
        "--where",
        "x:y=z",
        "--first-url",
        "--format",
        "webp",
        "--width",
        "600",
      ],
      {
        env,
        stdout: stdout as never,
        stderr: stderr as never,
        fetchImpl,
      },
    );

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe(
      "https://delivery-p123-e456.adobeaemcloud.com/adobe/assets/urn%3Aaaid%3Aaem%3Aabcd/as/asset.webp?width=600",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("prints the first matching asset id", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            results: [
              { assetId: "urn:aaid:aem:first" },
              { assetId: "urn:aaid:aem:second" },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const exitCode = await runCli(["search", "--text", "hero", "--first-id"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe("urn:aaid:aem:first");
    expect(stderr.toString()).toBe("");
  });

  test("prints one asset id per line for ids-only mode", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            results: [
              { assetId: "urn:aaid:aem:first" },
              { assetId: "urn:aaid:aem:second" },
            ],
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const exitCode = await runCli(["search", "--text", "hero", "--ids-only"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("urn:aaid:aem:first\nurn:aaid:aem:second\n");
    expect(stderr.toString()).toBe("");
  });

  test("prints raw search response json", async () => {
    const stdout = new MemoryStream();
    const stderr = new MemoryStream();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          hits: {
            results: [{ assetId: "urn:aaid:aem:first" }],
          },
          search_metadata: {
            count: 1,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const exitCode = await runCli(["search", "--text", "hero", "--json"], {
      env,
      stdout: stdout as never,
      stderr: stderr as never,
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toContain('"assetId": "urn:aaid:aem:first"');
    expect(stdout.toString()).toContain('"count": 1');
    expect(stderr.toString()).toBe("");
  });
});
