import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CliError } from "./client.js";

type SortOrder = "ASC" | "DESC";

export type SearchClause = {
  field: string;
  values: string[];
};

export type SearchRequest = {
  query: Array<Record<string, unknown>>;
  limit?: number;
  cursor?: string;
  projectedFields?: {
    includes: string[];
  };
  sort?: Array<{
    field: string;
    order?: SortOrder;
  }>;
};

export type SearchHit = {
  assetId?: string;
  id?: string;
  repositoryMetadata?: Record<string, unknown>;
  assetMetadata?: Record<string, unknown>;
};

export type SearchResponse = {
  hits?: {
    results?: SearchHit[];
  };
  cursor?: string;
  search_metadata?: {
    count?: number;
    totalCount?: {
      total?: number;
      relation?: string;
    };
  };
};

const whereSchema = z.string().trim().min(1);

export function normalizeSearchField(field: string): string {
  return /^(assetMetadata|repositoryMetadata)\./.test(field)
    ? field
    : `assetMetadata.${field}`;
}

export function parseWhereClause(input: string): SearchClause {
  const raw = whereSchema.parse(input);
  const separatorIndex = raw.indexOf("=");
  if (separatorIndex < 1) {
    throw new CliError(`Invalid --where clause "${input}". Use field=value.`);
  }

  const field = raw.slice(0, separatorIndex).trim();
  const rawValue = raw.slice(separatorIndex + 1).trim();
  if (!rawValue) {
    throw new CliError(`Invalid --where clause "${input}". Value cannot be empty.`);
  }

  const values = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) {
    throw new CliError(`Invalid --where clause "${input}". Value cannot be empty.`);
  }

  return {
    field: normalizeSearchField(field),
    values,
  };
}

export function parseSort(input: string): { field: string; order?: SortOrder } {
  const trimmed = input.trim();
  const match = /^(.*?):(asc|desc)$/i.exec(trimmed);
  if (!match) {
    return { field: trimmed };
  }

  return {
    field: match[1],
    order: match[2].toUpperCase() as SortOrder,
  };
}

export function buildSearchRequest(options: {
  text?: string;
  where?: string[];
  fields?: string[];
  sort?: string[];
  limit?: number;
  cursor?: string;
}): SearchRequest {
  const termClauses = (options.where ?? []).map(parseWhereClause);
  const query: Array<Record<string, unknown>> = [
    {
      match: {
        mode: "FULLTEXT",
        text: options.text ?? "",
      },
    },
  ];

  for (const clause of termClauses) {
    query.push({
      term: {
        [clause.field]: clause.values,
      },
    });
  }

  const request: SearchRequest = { query };

  if (options.limit !== undefined) {
    request.limit = options.limit;
  }

  if (options.cursor) {
    request.cursor = options.cursor;
  }

  if (options.fields && options.fields.length > 0) {
    request.projectedFields = {
      includes: options.fields,
    };
  }

  if (options.sort && options.sort.length > 0) {
    request.sort = options.sort.map(parseSort);
  }

  return request;
}

export async function loadRawQuery(input: string): Promise<SearchRequest> {
  const rawJson = input.startsWith("@")
    ? await readFile(input.slice(1), "utf8")
    : input;

  try {
    return JSON.parse(rawJson) as SearchRequest;
  } catch (error) {
    throw new CliError(
      `Unable to parse raw query JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getAssetIdFromHit(hit: SearchHit): string {
  const assetId = hit.assetId ?? hit.id;
  if (!assetId) {
    throw new CliError("Search result did not include an asset identifier.");
  }

  return assetId;
}
