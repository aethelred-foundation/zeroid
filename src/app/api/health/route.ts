import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
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
