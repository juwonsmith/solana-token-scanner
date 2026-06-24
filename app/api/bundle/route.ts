import { NextRequest, NextResponse } from "next/server";
import { detectBundle } from "@/lib/bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// launch analysis walks transaction history — give it room
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = body?.address;
    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "Provide a token address." }, { status: 400 });
    }
    const result = await detectBundle(address);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bundle analysis failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
