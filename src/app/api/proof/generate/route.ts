import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { circuitType, publicInputs } = body;

    if (!circuitType || !publicInputs) {
      return NextResponse.json(
        { error: "Missing circuitType or publicInputs" },
        { status: 400 },
      );
    }

    const validCircuits = [
      "age_proof",
      "residency_proof",
      "credit_tier_proof",
      "nationality_proof",
      "composite_proof",
    ];

    if (!validCircuits.includes(circuitType)) {
      return NextResponse.json(
        {
          error: `Invalid circuit type. Must be one of: ${validCircuits.join(", ")}`,
        },
        { status: 400 },
      );
    }

    // Forward to backend TEE service for server-side proof generation
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4003";
    const response = await fetch(
      `${apiUrl}/api/v1/verification/generate-proof`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ circuitType, publicInputs }),
      },
    );

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { error: error.message ?? "Proof generation failed" },
        { status: response.status },
      );
    }

    const proof = await response.json();
    return NextResponse.json(proof);
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
