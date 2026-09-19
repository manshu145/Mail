import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Public readiness endpoint: never disclose database, hosting, or secret state.
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
