import type { Metadata } from "next";
import { PublicKey } from "@solana/web3.js";
import { archivedCard, readLoanCard } from "@/lib/loan-health";

type Props = { params: Promise<{ position: string }> };

function appOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

async function cardFor(position: string) {
  try {
    return (await readLoanCard(new PublicKey(position))) ?? archivedCard(position);
  } catch {
    return archivedCard(position);
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { position } = await params;
  const card = await cardFor(position);
  const origin = appOrigin();
  const title = `${card.state.name} · ${card.symbol} ${(card.ltv * 100).toFixed(1)}% LTV`;
  return {
    title,
    description: `Catch ${card.symbol} loan · ${card.state.status}`,
    openGraph: {
      title,
      description: card.state.status,
      images: [{ url: `${origin}${card.state.image}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      images: [`${origin}${card.state.image}`],
    },
  };
}

export default async function LoanSharePage({ params }: Props) {
  const { position } = await params;
  const card = await cardFor(position);
  const label = card.open ? "Active" : card.liquidated ? "Liquidated" : "Closed";
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-4 py-10">
      <p className="mono text-xs tracking-[0.35em] text-amber-400/80">PRELEND</p>
      <h1 className="mt-2 text-3xl font-semibold">{card.state.emoji} {card.state.name}</h1>
      <p className="mt-1 text-sm text-slate-400">
        {card.symbol} · {label} · {(card.ltv * 100).toFixed(2)}% LTV
      </p>
      <div
        className="relative mt-6 overflow-hidden rounded-3xl"
        style={{ boxShadow: `0 0 40px ${card.state.glow}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={card.state.image} alt={card.state.name} width={640} height={640} />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
          <div className="text-lg">{card.state.status}</div>
          <div className="mono text-xs text-slate-300">
            Risk {card.state.risk} · Liquidation {card.state.liquidation}
          </div>
        </div>
      </div>
      <dl className="mt-5 grid w-full grid-cols-2 gap-2 text-sm text-slate-300">
        <div>Collateral {card.collateralUi.toFixed(4)}</div>
        <div>Borrowed ${card.borrowedUi.toFixed(2)}</div>
        <div>Price ${card.price.toFixed(2)}</div>
        <div className="mono truncate">{position.slice(0, 8)}…</div>
      </dl>
    </main>
  );
}
