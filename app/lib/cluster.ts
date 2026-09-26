export const PRELEND_PROGRAM_ID =
  process.env.NEXT_PUBLIC_PRELEND_PROGRAM_ID ??
  "HujDemHxNw2y7qJSDrgE1eYhVS8SGTvQL55oweQfNQfd";

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function rpcUrl() {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
}

export function isLocalRpc(url = rpcUrl()) {
  return /127\.0\.0\.1|localhost/.test(url);
}

export function isDevnetRpc(url = rpcUrl()) {
  return url.includes("devnet");
}

export function explorerAccount(address: string, url = rpcUrl()) {
  if (isLocalRpc(url)) return null;
  const cluster = isDevnetRpc(url) ? "?cluster=devnet" : "";
  return `https://solscan.io/account/${address}${cluster}`;
}

export function explorerTx(signature: string, url = rpcUrl()) {
  if (isLocalRpc(url)) return null;
  const cluster = isDevnetRpc(url) ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${signature}${cluster}`;
}
