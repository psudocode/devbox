import { lazy } from "react";
import { createRegistry } from "./registry-core";
import type { ToolDefinition } from "./types";

/**
 * Register new tools here. Each tool lives in `src/tools/<tool-id>/` and is lazy-loaded:
 *
 *   {
 *     id: "json-formatter",
 *     name: "JSON Formatter",
 *     description: "Prettify, minify and validate JSON",
 *     category: "Data & format",
 *     keywords: ["json", "prettify"],
 *     component: lazy(() => import("./json-formatter")),
 *   },
 */
export const toolDefinitions: ToolDefinition[] = [
  {
    id: "json-formatter",
    name: "JSON Formatter",
    description: "Prettify, minify, validate and sort keys. Keeps big numbers exact.",
    category: "Data & format",
    keywords: ["json", "prettify", "beautify", "minify", "validate", "sort", "lint"],
    acceptsText: true,
    component: lazy(() => import("./json-formatter")),
  },
  {
    id: "json-diff",
    name: "JSON Compare",
    description: "Structural diff of two JSON documents, ignoring key order and number formatting.",
    category: "Data & format",
    keywords: ["json", "diff", "compare", "difference", "changes"],
    acceptsText: true,
    component: lazy(() => import("./json-diff")),
  },
  {
    id: "number-base",
    name: "Number Base Converter",
    description: "Convert integers between bases 2-36 (hex, binary, decimal, octal). No size limit.",
    category: "Encode / decode / convert",
    keywords: ["hex", "binary", "decimal", "octal", "base", "radix", "bigint", "convert"],
    acceptsText: true,
    component: lazy(() => import("./number-base")),
  },
  {
    id: "base64",
    name: "Base64",
    description: "Encode and decode text as Base64, with URL-safe and unpadded variants.",
    category: "Encode / decode / convert",
    keywords: ["base64", "encode", "decode", "url-safe", "base64url", "utf-8"],
    acceptsText: true,
    component: lazy(() => import("./base64")),
  },
  {
    id: "url-encode",
    name: "URL Encode / Decode",
    description: "Percent-encode and decode text for URLs: component, full URL and form (+) modes.",
    category: "Encode / decode / convert",
    keywords: ["url", "uri", "percent", "encode", "decode", "escape", "query string", "urlencode"],
    acceptsText: true,
    component: lazy(() => import("./url-encode")),
  },
  {
    id: "jwt-decoder",
    name: "JWT Decoder",
    description: "Decode a JWT header and payload, read exp / nbf / iat. Does not verify the signature.",
    category: "Security",
    keywords: ["jwt", "json web token", "token", "bearer", "decode", "claims", "exp"],
    acceptsText: true,
    component: lazy(() => import("./jwt-decoder")),
  },
  {
    id: "hash-generator",
    name: "Hash Generator",
    description: "MD5, SHA-1, SHA-256, SHA-384, SHA-512 and HMAC for text or files, with checksum compare.",
    category: "Security",
    keywords: ["hash", "md5", "sha", "sha256", "sha512", "hmac", "checksum", "digest"],
    acceptsText: true,
    component: lazy(() => import("./hash-generator")),
  },
];

export const registry = createRegistry(toolDefinitions);
