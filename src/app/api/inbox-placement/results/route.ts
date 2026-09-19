import { NextResponse } from "next/server";

function retired() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export const GET = retired;
export const POST = retired;
export const PATCH = retired;
export const DELETE = retired;
