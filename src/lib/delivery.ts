import { z } from "zod";
import { CliError } from "./client.js";

export const DEFAULT_SEO_NAME = "asset";
export const TRANSFORM_FALLBACK_FORMAT = "avif";

export const deliveryFormatSchema = z.enum(["gif", "png", "jpg", "jpeg", "webp", "avif"]);

const qualitySchema = z.number().int().min(1).max(100);
const dimensionSchema = z.number().int().min(1);

export type DeliveryFormat = z.infer<typeof deliveryFormatSchema>;

export type DeliveryOptions = {
  assetId: string;
  seoName?: string;
  format?: DeliveryFormat;
  width?: number;
  height?: number;
  quality?: number;
  maxQuality?: number;
  original?: boolean;
};

export function parseSize(value: string): { width?: number; height?: number } {
  const match = /^(?<width>\d+)?x(?<height>\d+)?$/i.exec(value.trim());
  if (!match?.groups) {
    throw new CliError("Invalid --size value. Use WxH, Wxx, or xH.");
  }

  const width = match.groups.width ? Number(match.groups.width) : undefined;
  const height = match.groups.height ? Number(match.groups.height) : undefined;

  if (!width && !height) {
    throw new CliError("Invalid --size value. Provide at least width or height.");
  }

  if (width !== undefined) {
    dimensionSchema.parse(width);
  }

  if (height !== undefined) {
    dimensionSchema.parse(height);
  }

  return { width, height };
}

export function resolveDimensions(
  size: string | undefined,
  width: number | undefined,
  height: number | undefined,
): { width?: number; height?: number } {
  const sizeDimensions = size ? parseSize(size) : {};

  const resolvedWidth = width ?? sizeDimensions.width;
  const resolvedHeight = height ?? sizeDimensions.height;

  if (resolvedWidth !== undefined) {
    dimensionSchema.parse(resolvedWidth);
  }

  if (resolvedHeight !== undefined) {
    dimensionSchema.parse(resolvedHeight);
  }

  return {
    width: resolvedWidth,
    height: resolvedHeight,
  };
}

export function buildMetadataUrl(baseUrl: string, assetId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(assetId)}/metadata`;
}

export function buildAssetUrl(baseUrl: string, options: DeliveryOptions): string {
  const seoName = options.seoName ?? DEFAULT_SEO_NAME;
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const encodedAssetId = encodeURIComponent(options.assetId);
  const encodedSeoName = encodeURIComponent(seoName);

  if (options.quality !== undefined) {
    qualitySchema.parse(options.quality);
  }

  if (options.maxQuality !== undefined) {
    qualitySchema.parse(options.maxQuality);
  }

  if (options.width !== undefined) {
    dimensionSchema.parse(options.width);
  }

  if (options.height !== undefined) {
    dimensionSchema.parse(options.height);
  }

  if (options.original) {
    return `${normalizedBase}/${encodedAssetId}/original/as/${encodedSeoName}`;
  }

  const shouldUseTransformRoute =
    options.format !== undefined ||
    options.width !== undefined ||
    options.height !== undefined ||
    options.quality !== undefined ||
    options.maxQuality !== undefined;

  if (!shouldUseTransformRoute) {
    return `${normalizedBase}/${encodedAssetId}`;
  }

  const format = options.format ?? TRANSFORM_FALLBACK_FORMAT;
  const url = new URL(
    `${normalizedBase}/${encodedAssetId}/as/${encodedSeoName}.${format}`,
  );

  if (options.width !== undefined) {
    url.searchParams.set("width", String(options.width));
  }

  if (options.height !== undefined) {
    url.searchParams.set("height", String(options.height));
  }

  if (options.quality !== undefined) {
    url.searchParams.set("quality", String(options.quality));
  }

  if (options.maxQuality !== undefined) {
    url.searchParams.set("max-quality", String(options.maxQuality));
  }

  return url.toString();
}
