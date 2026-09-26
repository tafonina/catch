export type LoanRecord = {
  position: string;
  symbol: string;
  status: "open" | "liquidated" | "repaid" | "claimed";
  collateral: number;
  principal: number;
  surplus: number;
  at: number;
};

function key(wallet: string) {
  return `prelend.loans.${wallet}`;
}

export function readLoanHistory(wallet: string | null): LoanRecord[] {
  if (!wallet || typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(key(wallet));
    if (!raw) return [];
    const rows = JSON.parse(raw) as LoanRecord[];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

export function writeLoanHistory(wallet: string, rows: LoanRecord[]) {
  sessionStorage.setItem(key(wallet), JSON.stringify(rows.slice(0, 12)));
}

export function upsertLoanRecord(wallet: string | null, next: LoanRecord): LoanRecord[] {
  if (!wallet) return [];
  const rows = readLoanHistory(wallet).filter((r) => r.position !== next.position);
  rows.unshift(next);
  writeLoanHistory(wallet, rows);
  return rows;
}
