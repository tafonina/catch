import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { readUsdcVault, readUserMarket } from "@/lib/prelend";
import { appConnection } from "@/lib/rpc-connection";

export const dynamic = "force-dynamic";

function jsonSafe(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)),
  );
}

export async function GET(req: NextRequest) {
  try {
    const connection = appConnection();
    const wallet = req.nextUrl.searchParams.get("wallet");
    if (wallet) {
      return NextResponse.json(jsonSafe(await readUserMarket(new PublicKey(wallet), connection)));
    }
    return NextResponse.json(jsonSafe(await readUsdcVault(connection)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "vault read failed" },
      { status: 500 },
    );
  }
}
