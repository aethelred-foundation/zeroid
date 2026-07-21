import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const repositoryRoot = process.cwd();
const serverPath = path.join(
  repositoryRoot,
  ".next",
  "standalone",
  "server.js",
);

try {
  if (!(await stat(serverPath)).isFile()) {
    throw new Error("not a file");
  }
} catch {
  throw new Error(
    "ZeroID production bundle is missing. Run `npm run build` before `npm run start`.",
  );
}

process.env.NODE_ENV = "production";
nextEnv.loadEnvConfig(repositoryRoot, false);

process.env.HOSTNAME = "0.0.0.0";
process.env.PORT = process.env.PORT?.trim() || "3003";

const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid frontend PORT: ${process.env.PORT}`);
}

await import(pathToFileURL(serverPath).href);
