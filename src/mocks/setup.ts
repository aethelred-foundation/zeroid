import "@testing-library/jest-dom";

// Polyfill TextEncoder/TextDecoder for jsdom
import { TextEncoder, TextDecoder } from "util";
import { ReadableStream, TransformStream, WritableStream } from "stream/web";

Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
  ReadableStream,
  WritableStream,
  TransformStream,
});

// Polyfill crypto.subtle for jsdom (needed by crypto modules)
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line global-require
  const { webcrypto } = require("crypto");
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

// Polyfill Request/Response for jsdom (needed by API route tests)
if (typeof globalThis.Request === "undefined") {
  // eslint-disable-next-line global-require
  const { Request, Response, Headers } = require("undici");
  Object.assign(globalThis, { Request, Response, Headers });
}

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();
