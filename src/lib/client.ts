import { z } from "zod";

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export class HttpError extends CliError {
  readonly status: number;
  readonly statusText: string;
  readonly url: string;
  readonly responseBody: string;

  constructor(response: Response, url: string, responseBody: string) {
    const detail = responseBody ? `\n${responseBody}` : "";
    super(`HTTP ${response.status} ${response.statusText} for ${url}${detail}`, 1);
    this.name = "HttpError";
    this.status = response.status;
    this.statusText = response.statusText;
    this.url = url;
    this.responseBody = responseBody;
  }
}

const bucketSchema = z
  .string()
  .trim()
  .min(1, "Bucket value cannot be empty.");

export function normalizeBucket(input: string): string {
  const raw = bucketSchema.parse(input);
  const url = raw.startsWith("http://") || raw.startsWith("https://")
    ? new URL(raw)
    : new URL(`https://${raw}`);

  return new URL("/adobe/assets", url.origin).toString().replace(/\/$/, "");
}

export function resolveBucket(
  explicitValue: string | undefined,
  env: NodeJS.ProcessEnv,
  profileBucket?: string,
): string {
  const bucket = explicitValue ?? env.AEMDM_BUCKET ?? profileBucket;
  if (!bucket) {
    throw new CliError("Missing bucket. Use --bucket, set AEMDM_BUCKET, or save a profile bucket with `aemdm --bucket <bucket>`.");
  }

  return normalizeBucket(bucket);
}

export function resolveOptionalImsToken(
  explicitValue: string | undefined,
  env: NodeJS.ProcessEnv,
  profileImsToken?: string,
): string | undefined {
  return explicitValue ?? env.AEMDM_IMS_TOKEN ?? profileImsToken;
}

export function resolveSearchAuth(
  imsToken: string | undefined,
  apiKey: string | undefined,
  env: NodeJS.ProcessEnv,
  profileImsToken?: string,
): { imsToken: string; apiKey: string } {
  const resolvedImsToken = imsToken ?? env.AEMDM_IMS_TOKEN ?? profileImsToken;
  const resolvedApiKey = apiKey ?? env.AEMDM_API_KEY ?? "asset_search_service";

  if (!resolvedImsToken) {
    throw new CliError("Missing IMS token. Use --ims-token or set AEMDM_IMS_TOKEN.");
  }

  return {
    imsToken: resolvedImsToken,
    apiKey: resolvedApiKey,
  };
}

type RequestOptions = {
  method?: "GET" | "POST" | "HEAD";
  imsToken?: string;
  apiKey?: string;
  jsonBody?: unknown;
  headers?: HeadersInit;
  fetchImpl?: typeof fetch;
};

function buildHeaders(options: RequestOptions): Headers {
  const headers = new Headers(options.headers);

  if (options.imsToken) {
    headers.set("Authorization", `Bearer ${options.imsToken}`);
  }

  if (options.apiKey) {
    headers.set("X-Api-Key", options.apiKey);
  }

  if (options.jsonBody !== undefined) {
    headers.set("Content-Type", "application/json");
    headers.set("X-Adobe-Accept-Experimental", "1");
  }

  return headers;
}

export function joinAssetUrl(baseUrl: string, path: string): string {
  const normalizedBase = `${baseUrl.replace(/\/+$/, "")}/`;
  return new URL(path.replace(/^\/+/, ""), normalizedBase).toString();
}

export async function request(
  url: string,
  options: RequestOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(url, {
    method: options.method ?? (options.jsonBody === undefined ? "GET" : "POST"),
    headers: buildHeaders(options),
    body: options.jsonBody === undefined ? undefined : JSON.stringify(options.jsonBody),
  });

  if (!response.ok) {
    const responseBody = await response.text();
    throw new HttpError(response, url, responseBody);
  }

  return response;
}

export async function requestJson<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const response = await request(url, options);
  return response.json() as Promise<T>;
}
