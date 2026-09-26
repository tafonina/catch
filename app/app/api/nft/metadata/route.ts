import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { archivedCard, metadataJson, readLoanCard } from "@/lib/loan-health";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const positionParam = req.nextUrl.searchParams.get("position");
  if (!positionParam) {
    return NextResponse.json({ error: "position required" }, { status: 400 });
  }
  let position: PublicKey;
  try {
    position = new PublicKey(positionParam);
  } catch {
    return NextResponse.json({ error: "invalid position" }, { status: 400 });
  }
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const card = (await readLoanCard(position)) ?? archivedCard(position.toBase58());
  return NextResponse.json(metadataJson(card, origin), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
