"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  CodeError: () => CodeError,
  basename: () => basename,
  chunk: () => chunk,
  dirname: () => dirname,
  extname: () => extname,
  flatten: () => flatten,
  getErrorMessage: () => getErrorMessage,
  groupBy: () => groupBy,
  hasCode: () => hasCode,
  isValidSlug: () => isValidSlug,
  join: () => join,
  last: () => last,
  retry: () => retry,
  retrySync: () => retrySync,
  slugify: () => slugify,
  toError: () => toError,
  unique: () => unique
});
module.exports = __toCommonJS(index_exports);

// src/array.ts
function chunk(array, size) {
  if (size <= 0) {
    return [];
  }
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
function flatten(array) {
  const result = [];
  for (const item of array) {
    if (Array.isArray(item)) {
      result.push(...item);
    } else {
      result.push(item);
    }
  }
  return result;
}
function unique(array) {
  return [...new Set(array)];
}
function groupBy(array, getKey) {
  const result = {};
  for (const item of array) {
    const key = getKey(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}
function last(array) {
  return array[array.length - 1];
}

// src/error.ts
function toError(error) {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  return new Error(String(error));
}
function getErrorMessage(error) {
  return toError(error).message;
}
var CodeError = class _CodeError extends Error {
  code;
  constructor(message, code) {
    super(message);
    this.name = "CodeError";
    this.code = code;
    Object.setPrototypeOf(this, _CodeError.prototype);
  }
};
function hasCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

// src/path.ts
function join(...segments) {
  return segments.map((segment, index) => {
    if (index === 0) {
      return segment.endsWith("/") ? segment.slice(0, -1) : segment;
    }
    return segment.startsWith("/") ? segment.slice(1) : segment;
  }).filter(Boolean).join("/");
}
function extname(path) {
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1 || lastDot === path.length - 1) {
    return "";
  }
  return path.slice(lastDot);
}
function basename(path) {
  const lastSlash = path.lastIndexOf("/");
  const filename = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) {
    return filename;
  }
  return filename.slice(0, lastDot);
}
function dirname(path) {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return ".";
  }
  return path.slice(0, lastSlash) || "/";
}

// src/retry.ts
var import_effect = require("effect");
function retry(effect, config) {
  const { maxRetries, delayMs = 1e3, exponentialBackoff = false } = config;
  return effect.pipe(
    import_effect.Effect.retry({
      retries: maxRetries,
      schedule: delayMs > 0 ? exponentialBackoff ? import_effect.Schedule.exponential(delayMs) : import_effect.Schedule.spaced(delayMs) : void 0
    })
  );
}
function retrySync(fn, config) {
  const { maxRetries, delayMs = 1e3, exponentialBackoff = false } = config;
  let lastError;
  let delay = delayMs;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        if (exponentialBackoff) {
          delay *= 2;
        }
        const start = Date.now();
        while (Date.now() - start < delay) {
        }
      }
    }
  }
  throw lastError;
}

// src/slug.ts
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
}
function isValidSlug(slug) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CodeError,
  basename,
  chunk,
  dirname,
  extname,
  flatten,
  getErrorMessage,
  groupBy,
  hasCode,
  isValidSlug,
  join,
  last,
  retry,
  retrySync,
  slugify,
  toError,
  unique
});
