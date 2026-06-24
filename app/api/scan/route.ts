import { NextRequest, NextResponse } from "next/server";
import { scanToken } from "@/lib/scan";

// Solana web3.js needs the Node runtime (not edge)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = body?.address;
    if (!address || typeof address !== "string") {
      return NextResponse.json({ error: "Provide a token address." }, { status: 400 });
    }
    const report = await scanToken(address);
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
