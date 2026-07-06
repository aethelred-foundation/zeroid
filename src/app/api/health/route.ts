import { apiJson } from "../_lib/backend";

export async function GET() {
  return apiJson({
    status: "healthy",
    service: "zeroid-frontend",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
    checks: {
      api: "ok",
      circuits: "loaded",
    },
  });
}
