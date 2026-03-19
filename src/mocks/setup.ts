import "@testing-library/jest-dom";

// Polyfill TextEncoder/TextDecoder for jsdom
import { TextEncoder, TextDecoder } from "util";

Object.assign(globalThis, {
  TextEncoder,
  TextDecoder,
});

// Polyfill crypto.subtle for jsdom (needed by crypto modules)
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { webcrypto } = require("crypto");
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

// Polyfill Request/Response for jsdom (needed by API route tests)
if (typeof globalThis.Request === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Request, Response, Headers } = require("undici");
  Object.assign(globalThis, { Request, Response, Headers });
}

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();
