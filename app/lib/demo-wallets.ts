import { Keypair, PublicKey } from "@solana/web3.js";

export const DEMO_ROLES = ["borrower", "lender", "bidder"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export const FAUCET_USDC = 30_000;
export const FAUCET_ANTH = 30;
export const FAUCET_SOL = 0.01;
export const FAUCET_USDC_MAX = 100_000;
export const FAUCET_ANTH_MAX = 100;

export const DEMO_ROLE_LABEL: Record<DemoRole, string> = {
  borrower: "Borrower",
  lender: "Lender",
  bidder: "Bidder",
};

const STORE_KEY = "catch.demo.wallets.v1";
const ROLE_KEY = "catch.demo.activeRole";

type StoredWallets = Partial<Record<DemoRole, number[]>>;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function secretToBase58(bytes: Uint8Array) {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  const size = (((bytes.length - zeros) * 138) / 100 + 1) | 0;
  const buf = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; k >= 0 && (carry !== 0 || j < length); k -= 1, j += 1) {
      carry += 256 * buf[k];
      buf[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let it = size - length;
  while (it < size && buf[it] === 0) it += 1;
  let out = "1".repeat(zeros);
  for (; it < size; it += 1) out += B58[buf[it]];
  return out;
}

function readStore(): StoredWallets {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as StoredWallets;
  } catch {
    return {};
  }
}

function writeStore(next: StoredWallets) {
  localStorage.setItem(STORE_KEY, JSON.stringify(next));
}

export function activeDemoRole(): DemoRole | null {
  if (typeof window === "undefined") return null;
  const role = sessionStorage.getItem(ROLE_KEY);
  return DEMO_ROLES.includes(role as DemoRole) ? (role as DemoRole) : null;
}

export function setActiveDemoRole(role: DemoRole | null) {
  if (typeof window === "undefined") return;
  if (role) sessionStorage.setItem(ROLE_KEY, role);
  else sessionStorage.removeItem(ROLE_KEY);
}

export function isDemoWalletActive() {
  return activeDemoRole() !== null;
}

export function ensureDemoKeypair(role: DemoRole) {
  const store = readStore();
  const raw = store[role];
  if (raw?.length === 64) return Keypair.fromSecretKey(Uint8Array.from(raw));
  const created = Keypair.generate();
  store[role] = Array.from(created.secretKey);
  writeStore(store);
  return created;
}

export function demoKeypair(): Keypair | null {
  const role = activeDemoRole();
  if (!role) return null;
  const raw = readStore()[role];
  if (!raw || raw.length !== 64) return null;
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

export function demoPublicKey(): PublicKey | null {
  return demoKeypair()?.publicKey ?? null;
}

export function exportActiveDemoSecret() {
  const pair = demoKeypair();
  if (!pair) return null;
  return {
    role: activeDemoRole(),
    publicKey: pair.publicKey.toBase58(),
    secretBase58: secretToBase58(pair.secretKey),
  };
}
