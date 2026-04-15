import { mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SearchResponse } from "./search.js";

function valueToString(value: unknown): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return value === undefined || value === null ? "" : String(value);
}

export function writeLine(stream: NodeJS.WritableStream, line: string): void {
  stream.write(`${line}\n`);
}

export function writeJson(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function formatSearchResults(response: SearchResponse): string {
  const results = response.hits?.results ?? [];
  if (results.length === 0) {
    return "No results.";
  }

  const rows = [
    ["assetId", "name", "format", "title"],
    ...results.map((result) => [
      valueToString(result.assetId ?? result.id),
      valueToString(result.repositoryMetadata?.["repo:name"]),
      valueToString(result.repositoryMetadata?.["dc:format"]),
      valueToString(result.assetMetadata?.["dc:title"]),
    ]),
  ];

  const widths = rows[0].map((_, columnIndex) =>
    Math.max(...rows.map((row) => row[columnIndex].length)),
  );

  return rows
    .map((row) =>
      row
        .map((cell, columnIndex) => cell.padEnd(widths[columnIndex]))
        .join("  "),
    )
    .join("\n");
}

export async function writeBinaryOutput(
  response: Response,
  output: string,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  if (!response.body) {
    throw new Error("Response body is empty.");
  }

  const readable = Readable.fromWeb(response.body as never);

  if (output === "-") {
    for await (const chunk of readable) {
      stdout.write(chunk);
    }
    return;
  }

  await mkdir(path.dirname(output), { recursive: true });
  const fileStream = createWriteStream(output);
  await pipeline(readable, fileStream);
}
