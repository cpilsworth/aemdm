import { describe, expect, test } from "vitest";
import {
  buildAssetUrl,
  buildMetadataUrl,
  parseSize,
  resolveDimensions,
} from "../src/lib/delivery.js";

describe("delivery helpers", () => {
  test("builds transformed URL with format, dimensions, and quality", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
      seoName: "hero",
      format: "webp",
      width: 1200,
      height: 800,
      quality: 75,
    });

    expect(url).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/as/hero.webp?width=1200&height=800&quality=75",
    );
  });

  test("uses original route when requested", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
      seoName: "source-file",
      original: true,
    });

    expect(url).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/original/as/source-file",
    );
  });

  test("falls back to convenience route with no transforms", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
    });

    expect(url).toBe("https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/as/asset.png");
  });

  test("parses size shortcuts", () => {
    expect(parseSize("300x200")).toEqual({ width: 300, height: 200 });
    expect(parseSize("300x")).toEqual({ width: 300, height: undefined });
    expect(parseSize("x200")).toEqual({ width: undefined, height: 200 });
  });

  test("width and height override size values", () => {
    expect(resolveDimensions("300x200", 400, undefined)).toEqual({
      width: 400,
      height: 200,
    });
  });

  test("uses original route for document MIME types", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
      mimeType: "application/pdf",
    });

    expect(url).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/original/as/asset",
    );
  });

  test("uses original route for video MIME types", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
      mimeType: "video/mp4",
    });

    expect(url).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/original/as/asset",
    );
  });

  test("uses image route for image MIME types", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
      mimeType: "image/jpeg",
    });

    expect(url).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/as/asset.png",
    );
  });

  test("explicit original flag takes precedence over image MIME type", () => {
    const url = buildAssetUrl("https://delivery.example.com/adobe/assets", {
      assetId: "urn:aaid:aem:1234",
      mimeType: "image/jpeg",
      original: true,
    });

    expect(url).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/original/as/asset",
    );
  });

  test("builds metadata route", () => {
    expect(buildMetadataUrl("https://delivery.example.com/adobe/assets", "urn:aaid:aem:1234")).toBe(
      "https://delivery.example.com/adobe/assets/urn:aaid:aem:1234/metadata",
    );
  });
});
