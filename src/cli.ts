#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { Command, CommanderError, Option } from "commander";
import { z } from "zod";
import {
  CliError,
  request,
  requestJson,
  resolveBucket,
  resolveOptionalImsToken,
  resolveSearchAuth,
} from "./lib/client.js";
import {
  readProfileConfig,
  writeProfileConfig,
} from "./lib/config.js";
import {
  buildAssetUrl,
  buildMetadataUrl,
  deliveryFormatSchema,
  resolveDimensions,
} from "./lib/delivery.js";
import {
  buildSearchRequest,
  getAssetIdFromHit,
  loadRawQuery,
  type SearchResponse,
} from "./lib/search.js";
import {
  formatSearchResults,
  writeBinaryOutput,
  writeJson,
  writeLine,
} from "./lib/output.js";

type Runtime = {
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  fetchImpl: typeof fetch;
  verbose: boolean;
};

function verbose(runtime: Runtime, message: string): void {
  if (runtime.verbose) {
    writeLine(runtime.stderr, `[verbose] ${message}`);
  }
}

type AssetGetOptions = {
  bucket?: string;
  format?: string;
  size?: string;
  width?: number;
  height?: number;
  quality?: number;
  maxQuality?: number;
  seoName?: string;
  original?: boolean;
  binary?: boolean;
  output?: string;
  metadata?: boolean;
  imsToken?: string;
};

type SearchOptions = {
  bucket?: string;
  imsToken?: string;
  apiKey?: string;
  text?: string;
  where?: string[];
  limit?: number;
  cursor?: string;
  field?: string[];
  sort?: string[];
  rawQuery?: string;
  json?: boolean;
  idsOnly?: boolean;
  firstId?: boolean;
  firstUrl?: boolean;
  firstMetadata?: boolean;
  firstBinary?: boolean;
  output?: string;
  format?: string;
  size?: string;
  width?: number;
  height?: number;
  quality?: number;
  maxQuality?: number;
  seoName?: string;
  original?: boolean;
};

const numberOption = (flagName: string) => (value: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new CliError(`${flagName} must be an integer.`);
  }

  return parsed;
};

const collectValues = (value: string, previous: string[] = []) => [...previous, value];

const assetGetSchema = z
  .object({
    bucket: z.string().optional(),
    format: deliveryFormatSchema.optional(),
    size: z.string().optional(),
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    maxQuality: z.number().int().min(1).max(100).optional(),
    seoName: z.string().trim().min(1).default("asset"),
    original: z.boolean().default(false),
    binary: z.boolean().default(false),
    output: z.string().optional(),
    metadata: z.boolean().default(false),
    imsToken: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.metadata && value.output) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--output cannot be used with --metadata.",
        path: ["output"],
      });
    }

    if (value.metadata && value.binary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--metadata and --binary cannot be used together.",
        path: ["binary"],
      });
    }

    if (value.metadata && value.original) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--metadata and --original cannot be used together.",
        path: ["original"],
      });
    }

    if (value.metadata && (value.format || value.size || value.width || value.height || value.quality || value.maxQuality)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--metadata cannot be combined with delivery modifier flags.",
        path: ["metadata"],
      });
    }

    if (value.binary && !value.output) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--output is required when using --binary. Use --output - for stdout.",
        path: ["output"],
      });
    }

    if (value.original && (value.format || value.size || value.width || value.height || value.quality || value.maxQuality)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--original cannot be combined with delivery modifier flags.",
        path: ["original"],
      });
    }
  });

const searchSchema = z
  .object({
    bucket: z.string().optional(),
    imsToken: z.string().optional(),
    apiKey: z.string().optional(),
    text: z.string().optional(),
    where: z.array(z.string()).default([]),
    limit: z.number().int().min(0).max(1000).optional(),
    cursor: z.string().optional(),
    field: z.array(z.string()).default([]),
    sort: z.array(z.string()).default([]),
    rawQuery: z.string().optional(),
    json: z.boolean().default(false),
    idsOnly: z.boolean().default(false),
    firstId: z.boolean().default(false),
    firstUrl: z.boolean().default(false),
    firstMetadata: z.boolean().default(false),
    firstBinary: z.boolean().default(false),
    output: z.string().optional(),
    format: deliveryFormatSchema.optional(),
    size: z.string().optional(),
    width: z.number().int().min(1).optional(),
    height: z.number().int().min(1).optional(),
    quality: z.number().int().min(1).max(100).optional(),
    maxQuality: z.number().int().min(1).max(100).optional(),
    seoName: z.string().trim().min(1).default("asset"),
    original: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const firstModeCount = [value.firstId, value.firstUrl, value.firstMetadata, value.firstBinary]
      .filter(Boolean).length;
    if (firstModeCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use only one of --first-id, --first-url, --first-metadata, or --first-binary.",
        path: ["firstId"],
      });
    }

    const outputModeCount = [value.json, value.idsOnly, firstModeCount > 0].filter(Boolean).length;
    if (outputModeCount > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use only one of --json, --ids-only, or a --first-* option.",
        path: ["json"],
      });
    }

    if (value.firstBinary && !value.output) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--output is required when using --first-binary. Use --output - for stdout.",
        path: ["output"],
      });
    }

    if (!value.firstBinary && value.output) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--output is only valid with --first-binary.",
        path: ["output"],
      });
    }

    if (value.rawQuery && (value.text || value.where.length > 0 || value.field.length > 0 || value.sort.length > 0 || value.limit !== undefined || value.cursor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--raw-query cannot be combined with --text, --where, --field, --sort, --limit, or --cursor.",
        path: ["rawQuery"],
      });
    }

    if (value.original && (value.format || value.size || value.width || value.height || value.quality || value.maxQuality)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "--original cannot be combined with delivery modifier flags.",
        path: ["original"],
      });
    }
  });

function parseWithSchema<T>(schema: z.ZodType<T>, options: unknown): T {
  const result = schema.safeParse(options);
  if (!result.success) {
    throw new CliError(result.error.issues.map((issue) => issue.message).join("\n"));
  }

  return result.data;
}

async function handleAssetGet(
  assetId: string,
  options: AssetGetOptions,
  runtime: Runtime,
): Promise<void> {
  const parsed = parseWithSchema(assetGetSchema, options);
  const profile = await readProfileConfig(runtime.env);
  const baseUrl = resolveBucket(parsed.bucket, runtime.env, profile.bucket);
  const imsToken = resolveOptionalImsToken(parsed.imsToken, runtime.env);
  const dimensions = resolveDimensions(parsed.size, parsed.width, parsed.height);

  verbose(runtime, `bucket: ${baseUrl}`);
  verbose(runtime, `asset:  ${assetId}`);
  if (imsToken) verbose(runtime, `auth:   IMS token provided`);
  if (dimensions.width || dimensions.height) {
    verbose(runtime, `dimensions: ${dimensions.width ?? "auto"}x${dimensions.height ?? "auto"}`);
  }
  if (parsed.format) verbose(runtime, `format: ${parsed.format}`);
  if (parsed.quality) verbose(runtime, `quality: ${parsed.quality}`);

  if (parsed.metadata) {
    const metadata = imsToken
      ? await requestJson(buildMetadataUrl(baseUrl, assetId), {
          imsToken,
          fetchImpl: runtime.fetchImpl,
        })
      : await fetchBasicAssetMetadata(assetId, baseUrl, runtime);
    writeJson(runtime.stdout, metadata);
    return;
  }

  const url = buildAssetUrl(baseUrl, {
    assetId,
    seoName: parsed.seoName,
    format: parsed.format,
    width: dimensions.width,
    height: dimensions.height,
    quality: parsed.quality,
    maxQuality: parsed.maxQuality,
    original: parsed.original,
  });

  if (!parsed.binary) {
    writeLine(runtime.stdout, url);
    return;
  }

  const response = await request(url, {
    imsToken,
    fetchImpl: runtime.fetchImpl,
  });
  await writeBinaryOutput(response, parsed.output!, runtime.stdout);
}

async function buildSearchBody(parsed: z.infer<typeof searchSchema>) {
  if (parsed.rawQuery) {
    return loadRawQuery(parsed.rawQuery);
  }

  return buildSearchRequest({
    text: parsed.text,
    where: parsed.where,
    fields: parsed.field,
    sort: parsed.sort,
    limit: parsed.limit,
    cursor: parsed.cursor,
  });
}

async function handleSearch(options: SearchOptions, runtime: Runtime): Promise<void> {
  const parsed = parseWithSchema(searchSchema, options);
  const profile = await readProfileConfig(runtime.env);
  const baseUrl = resolveBucket(parsed.bucket, runtime.env, profile.bucket);
  const { imsToken, apiKey } = resolveSearchAuth(parsed.imsToken, parsed.apiKey, runtime.env);
  const searchBody = await buildSearchBody(parsed);
  const searchUrl = `${baseUrl}/search`;

  verbose(runtime, `bucket:   ${baseUrl}`);
  verbose(runtime, `search:   POST ${searchUrl}`);
  verbose(runtime, `api-key:  ${apiKey}`);
  verbose(runtime, `auth:     IMS token provided`);
  if (parsed.text) verbose(runtime, `text:     "${parsed.text}"`);
  if (parsed.where.length > 0) verbose(runtime, `where:    ${parsed.where.join(", ")}`);
  if (parsed.limit !== undefined) verbose(runtime, `limit:    ${parsed.limit}`);
  if (parsed.rawQuery) verbose(runtime, `raw-query: ${parsed.rawQuery}`);

  const response = await requestJson<SearchResponse>(searchUrl, {
    method: "POST",
    imsToken,
    apiKey,
    jsonBody: searchBody,
    fetchImpl: runtime.fetchImpl,
  });

  const resultCount = response.hits?.results?.length ?? 0;
  const totalCount = response.search_metadata?.totalCount?.total;
  verbose(runtime, `results:  ${resultCount} returned${totalCount !== undefined ? ` (${totalCount} total)` : ""}`);

  if (parsed.json) {
    writeJson(runtime.stdout, response);
    return;
  }

  if (parsed.idsOnly) {
    const hits = response.hits?.results ?? [];
    for (const hit of hits) {
      writeLine(runtime.stdout, getAssetIdFromHit(hit));
    }
    return;
  }

  const firstHit = response.hits?.results?.[0];
  if (parsed.firstId || parsed.firstUrl || parsed.firstMetadata || parsed.firstBinary) {
    if (!firstHit) {
      throw new CliError("No search results found for the requested first-result action.");
    }

    const assetId = getAssetIdFromHit(firstHit);

    if (parsed.firstId) {
      writeLine(runtime.stdout, assetId);
      return;
    }

    if (parsed.firstMetadata) {
      const metadata = await requestJson(buildMetadataUrl(baseUrl, assetId), {
        imsToken,
        fetchImpl: runtime.fetchImpl,
      });
      writeJson(runtime.stdout, metadata);
      return;
    }

    const dimensions = resolveDimensions(parsed.size, parsed.width, parsed.height);
    const assetUrl = buildAssetUrl(baseUrl, {
      assetId,
      seoName: parsed.seoName,
      format: parsed.format,
      width: dimensions.width,
      height: dimensions.height,
      quality: parsed.quality,
      maxQuality: parsed.maxQuality,
      original: parsed.original,
    });

    if (parsed.firstUrl) {
      writeLine(runtime.stdout, assetUrl);
      return;
    }

    const binaryResponse = await request(assetUrl, {
      imsToken,
      fetchImpl: runtime.fetchImpl,
    });
    await writeBinaryOutput(binaryResponse, parsed.output!, runtime.stdout);
    return;
  }

  writeLine(runtime.stdout, formatSearchResults(response));
}

async function fetchBasicAssetMetadata(
  assetId: string,
  baseUrl: string,
  runtime: Runtime,
): Promise<Record<string, unknown>> {
  const url = buildAssetUrl(baseUrl, { assetId });
  let response = await runtime.fetchImpl(url, { method: "HEAD" });

  // Some delivery endpoints may not support HEAD, so fall back to GET and
  // discard the body after reading the headers.
  if (response.status === 405 || response.status === 501) {
    response = await runtime.fetchImpl(url);
    await response.body?.cancel();
  }

  if (!response.ok) {
    throw new CliError(
      `Unable to fetch public metadata for ${url}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? undefined : Number(contentLengthHeader);

  return {
    mode: "basic",
    assetId,
    publicUrl: response.url || url,
    contentType: response.headers.get("content-type") ?? undefined,
    contentDisposition: response.headers.get("content-disposition") ?? undefined,
    etag: response.headers.get("etag") ?? undefined,
    cacheControl: response.headers.get("cache-control") ?? undefined,
    contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    auth: "public",
  };
}

function configureCommonDeliveryOptions(command: Command): Command {
  return command
    .addOption(new Option("--format <format>", "Output format").choices(deliveryFormatSchema.options))
    .option("--size <WxH>", "Convenience image size, for example 300x200, 300x, or x200")
    .option("--width <px>", "Output width in pixels", numberOption("--width"))
    .option("--height <px>", "Output height in pixels", numberOption("--height"))
    .option("--quality <1-100>", "Output quality", numberOption("--quality"))
    .option("--max-quality <1-100>", "Max dynamic quality", numberOption("--max-quality"))
    .option("--seo-name <name>", "SEO name for transformed/original routes", "asset")
    .option("--original", "Use the original binary route");
}

function buildProgram(runtime: Runtime): Command {
  const program = new Command();
  program
    .name("aemdm")
    .description("CLI for Adobe Dynamic Media with OpenAPI")
    .version("0.2.2")
    .showHelpAfterError()
    .option("-v, --verbose", "Show additional diagnostic output")
    .configureOutput({
      writeOut: (text) => runtime.stdout.write(text),
      writeErr: (text) => runtime.stderr.write(text),
    })
    .exitOverride()
    .hook("preAction", () => {
      runtime.verbose = program.opts().verbose === true;
    });

  configureCommonDeliveryOptions(
    program.command("asset").description("Asset operations"),
  )
    .command("get <assetId>")
    .description("Build a delivery URL, fetch metadata, or download a binary for an asset")
    .option("--bucket <bucket-or-url>", "Bucket host or full bucket URL")
    .option("--binary", "Fetch the binary instead of printing the URL")
    .option("--output <file>", "Output file path for --binary. Use - for stdout")
    .option("--metadata", "Fetch metadata JSON instead of building a URL")
    .option("--ims-token <token>", "IMS bearer token for metadata or binary requests")
    .action((assetId: string, options: AssetGetOptions) => handleAssetGet(assetId, options, runtime));

  configureCommonDeliveryOptions(
    program.command("search").description("Search assets and optionally resolve the first result"),
  )
    .option("--bucket <bucket-or-url>", "Bucket host or full bucket URL")
    .option("--ims-token <token>", "IMS bearer token")
    .option("--api-key <key>", "Adobe API key")
    .option("--text <query>", "Full-text search query")
    .option("--where <field=value>", "Metadata filter clause", collectValues, [])
    .option("--limit <n>", "Maximum items to fetch", numberOption("--limit"))
    .option("--cursor <cursor>", "Opaque cursor for pagination")
    .option("--field <path>", "Projected field to include in results", collectValues, [])
    .option("--sort <field[:ASC|DESC]>", "Sort rule", collectValues, [])
    .option("--raw-query <json-or-@file>", "Raw JSON search request or @file path")
    .option("--json", "Print the raw search response as JSON")
    .option("--ids-only", "Print one asset ID per line")
    .option("--first-id", "Print the first matching asset ID")
    .option("--first-url", "Print a delivery URL for the first result")
    .option("--first-metadata", "Fetch metadata for the first result")
    .option("--first-binary", "Download the first result binary")
    .option("--output <file>", "Output file path for --first-binary. Use - for stdout")
    .action((options: SearchOptions) => handleSearch(options, runtime));

  return program;
}

function renderSkillText(): string {
  return `aemdm skill

Purpose:
Use aemdm to work with Adobe Dynamic Media with OpenAPI assets from the command line. It can build delivery URLs, fetch metadata, download binaries, and search activated assets.

Core commands:
- aemdm asset get <assetId>
- aemdm search

Important defaults:
- Bucket comes from --bucket or AEMDM_BUCKET.
- A standalone call like aemdm --bucket delivery-p123-e456.adobeaemcloud.com saves the default bucket to the local aemdm profile config.
- Search auth comes from --ims-token/AEMDM_IMS_TOKEN and --api-key/AEMDM_API_KEY.
- asset get prints a URL by default.
- asset get --metadata prints full JSON metadata when authenticated, or basic public JSON metadata when no token is supplied.
- asset get --binary downloads the asset and requires --output.
- search --first-id prints one asset ID for piping.
- search --ids-only prints one asset ID per line.
- search --json prints the raw search response.

Asset URL examples:
- aemdm asset get urn:aaid:aem:1234 --bucket delivery-p123-e456.adobeaemcloud.com
- aemdm asset get urn:aaid:aem:1234 --format webp --size 1200x800 --quality 75
- aemdm asset get urn:aaid:aem:1234 --original --binary --output ./asset.bin
- aemdm asset get urn:aaid:aem:1234 --metadata
- aemdm asset get urn:aaid:aem:1234 --metadata --ims-token <token>

Search examples:
- aemdm search --text "hero banner"
- aemdm search --where x:y=z
- aemdm search --where repositoryMetadata.dc:format=image/jpeg,image/png
- aemdm search --first-id --where x:y=z
- aemdm search --ids-only --text "homepage"
- aemdm search --json --text "homepage"
- aemdm search --text "homepage" --first-url --format webp --width 800
- aemdm search --text "homepage" --first-metadata
- aemdm search --text "homepage" --first-binary --output ./first.bin

Filter DSL:
- --where x:y=z maps to assetMetadata.x:y = ["z"]
- --where repositoryMetadata.dc:format=image/jpeg,image/png maps to an exact-match term filter with multiple values

Raw query escape hatch:
- aemdm search --raw-query '{"query":[{"match":{"text":"homepage","mode":"FULLTEXT"}}]}'
- aemdm search --raw-query @./query.json

LLM usage guidance:
- Use asset get when you already know the asset ID.
- Use search when you need to discover an asset by metadata or text.
- Prefer --first-id or --ids-only when another CLI call needs asset IDs.
- Prefer --first-url when the user wants a delivery URL from a search result.
- Prefer --first-metadata when the user wants the resolved asset metadata after search.
- Prefer --first-binary with --output when the user wants the downloaded file.
`;
}

function getStandaloneBucketValue(argv: string[]): string | undefined {
  if (argv.length === 1 && argv[0].startsWith("--bucket=")) {
    return argv[0].slice("--bucket=".length);
  }

  if (argv.length === 2 && argv[0] === "--bucket") {
    return argv[1];
  }

  return undefined;
}

function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof CommanderError) {
    if (
      Number(error.exitCode) === 0 ||
      error.code === "commander.help" ||
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version" ||
      error.code === "commander.versionDisplayed"
    ) {
      return new CliError("", 0);
    }

    return new CliError(error.message, Number(error.exitCode) || 1);
  }

  if (error instanceof Error) {
    return new CliError(error.message);
  }

  return new CliError(String(error));
}

export async function runCli(
  argv: string[],
  runtimeOverrides: Partial<Runtime> = {},
): Promise<number> {
  const runtime: Runtime = {
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
    fetchImpl: fetch,
    verbose: false,
    ...runtimeOverrides,
  };

  try {
    const standaloneBucket = getStandaloneBucketValue(argv);
    if (standaloneBucket !== undefined) {
      const bucket = resolveBucket(standaloneBucket, runtime.env);
      const configPath = await writeProfileConfig(runtime.env, { bucket });
      writeLine(runtime.stdout, `Saved bucket to profile config: ${bucket}`);
      writeLine(runtime.stdout, `Config file: ${configPath}`);
      return 0;
    }

    if (argv.includes("--skill")) {
      writeLine(runtime.stdout, renderSkillText().trimEnd());
      return 0;
    }

    const program = buildProgram(runtime);
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (error) {
    const cliError = toCliError(error);
    if (cliError.message) {
      writeLine(runtime.stderr, cliError.message);
    }
    return cliError.exitCode;
  }
}

const executedDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);

if (executedDirectly) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
