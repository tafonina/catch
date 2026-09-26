import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

export const TOKEN_METADATA_PROGRAM = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const NFT_STORE = "prelend.loanNft.";

const enc = new TextEncoder();

export function metadataPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [enc.encode("metadata"), TOKEN_METADATA_PROGRAM.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM,
  )[0];
}

export function editionPda(mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [
      enc.encode("metadata"),
      TOKEN_METADATA_PROGRAM.toBuffer(),
      mint.toBuffer(),
      enc.encode("edition"),
    ],
    TOKEN_METADATA_PROGRAM,
  )[0];
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

function borshString(value: string) {
  const bytes = new TextEncoder().encode(value);
  const buf = new Uint8Array(4 + bytes.length);
  new DataView(buf.buffer).setUint32(0, bytes.length, true);
  buf.set(bytes, 4);
  return buf;
}

function createMetadataIx(params: {
  metadata: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}) {
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM,
    keys: [
      { pubkey: params.metadata, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: false },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: concat(
      new Uint8Array([33]),
      borshString(params.name.slice(0, 32)),
      borshString(params.symbol.slice(0, 10)),
      borshString(params.uri.slice(0, 200)),
      new Uint8Array([0, 0]),
      new Uint8Array([0]),
      new Uint8Array([0]),
      new Uint8Array([0]),
      new Uint8Array([1]),
      new Uint8Array([0]),
    ),
  });
}

function createMasterEditionIx(params: {
  edition: PublicKey;
  metadata: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
}) {
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM,
    keys: [
      { pubkey: params.edition, isSigner: false, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: true },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.authority, isSigner: true, isWritable: false },
      { pubkey: params.authority, isSigner: true, isWritable: true },
      { pubkey: params.metadata, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: concat(new Uint8Array([17]), new Uint8Array([1]), new Uint8Array(8)),
  });
}

function burnNftIx(params: {
  metadata: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  token: PublicKey;
  edition: PublicKey;
}) {
  return new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM,
    keys: [
      { pubkey: params.metadata, isSigner: false, isWritable: true },
      { pubkey: params.owner, isSigner: true, isWritable: true },
      { pubkey: params.mint, isSigner: false, isWritable: true },
      { pubkey: params.token, isSigner: false, isWritable: true },
      { pubkey: params.edition, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: new Uint8Array([29]),
  });
}

export function nftStorageKey(position: string) {
  return `${NFT_STORE}${position}`;
}

export function readStoredNft(position: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(nftStorageKey(position));
}

export function writeStoredNft(position: string, mint: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(nftStorageKey(position), mint);
}

export function clearStoredNft(position: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(nftStorageKey(position));
}

function readBorshString(data: Uint8Array, offset: number) {
  const len = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
  const start = offset + 4;
  return {
    value: new TextDecoder().decode(data.subarray(start, start + len)),
    next: start + len,
  };
}

function metadataUri(data: Uint8Array) {
  let o = 1 + 32 + 32;
  o = readBorshString(data, o).next;
  o = readBorshString(data, o).next;
  return readBorshString(data, o).value;
}

export async function findLoanNft(
  connection: Connection,
  owner: PublicKey,
  position: string,
) {
  const stored = readStoredNft(position);
  if (stored) {
    const mint = new PublicKey(stored);
    const ata = getAssociatedTokenAddressSync(mint, owner);
    const info = await connection.getAccountInfo(ata);
    if (info) return mint;
  }
  const parsed = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  for (const account of parsed.value) {
    const tok = account.account.data.parsed.info;
    if (Number(tok.tokenAmount.decimals) !== 0 || Number(tok.tokenAmount.uiAmount) !== 1) continue;
    const mint = new PublicKey(tok.mint);
    const meta = await connection.getAccountInfo(metadataPda(mint));
    if (!meta) continue;
    try {
      if (metadataUri(meta.data).includes(position)) {
        writeStoredNft(position, mint.toBase58());
        return mint;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function buildMintLoanNftTx(params: {
  connection: Connection;
  owner: PublicKey;
  position: PublicKey;
  symbol: string;
  uri: string;
}) {
  const mint = Keypair.generate();
  const ata = getAssociatedTokenAddressSync(mint.publicKey, params.owner);
  const metadata = metadataPda(mint.publicKey);
  const edition = editionPda(mint.publicKey);
  const lamports = await params.connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: params.owner,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint.publicKey, 0, params.owner, params.owner),
    createAssociatedTokenAccountIdempotentInstruction(
      params.owner,
      ata,
      params.owner,
      mint.publicKey,
    ),
    createMintToInstruction(mint.publicKey, ata, params.owner, 1),
    createMetadataIx({
      metadata,
      mint: mint.publicKey,
      authority: params.owner,
      name: `Catch ${params.symbol} #${params.position.toBase58().slice(0, 6)}`,
      symbol: `C-${params.symbol.slice(0, 4)}`,
      uri: params.uri,
    }),
    createMasterEditionIx({
      edition,
      metadata,
      mint: mint.publicKey,
      authority: params.owner,
    }),
  );
  tx.feePayer = params.owner;
  return { tx, mint };
}

export function buildBurnLoanNftTx(params: { owner: PublicKey; mint: PublicKey }) {
  const ata = getAssociatedTokenAddressSync(params.mint, params.owner);
  const tx = new Transaction().add(
    burnNftIx({
      metadata: metadataPda(params.mint),
      owner: params.owner,
      mint: params.mint,
      token: ata,
      edition: editionPda(params.mint),
    }),
  );
  tx.feePayer = params.owner;
  return tx;
}

export function buildSplBurnNftTx(params: { owner: PublicKey; mint: PublicKey }) {
  const ata = getAssociatedTokenAddressSync(params.mint, params.owner);
  const tx = new Transaction().add(
    createBurnInstruction(ata, params.mint, params.owner, 1),
    createCloseAccountInstruction(ata, params.owner, params.owner),
  );
  tx.feePayer = params.owner;
  return tx;
}

export function metadataUriFor(origin: string, position: PublicKey) {
  return `${origin.replace(/\/$/, "")}/api/nft/metadata?position=${position.toBase58()}`;
}
