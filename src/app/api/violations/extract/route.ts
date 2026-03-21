import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  // This endpoint is not yet available in production
  // It will be enabled once the full extraction pipeline is ready
  void request;
  return NextResponse.json(
    { error: "Full extraction is not yet available. Use /api/violations/preview instead." },
    { status: 503 }
  );
}
