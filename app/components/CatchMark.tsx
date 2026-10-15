import Link from "next/link";

/** Shared mark + wordmark for site header and dapp header */
export const CATCH_MARK_CLASS =
  "h-12 w-12 shrink-0 rounded-xl border border-[rgba(212,175,55,0.24)]";

export const CATCH_WORDMARK_CLASS = "text-2xl font-semibold tracking-tight";

export const CATCH_BRAND_LINK_CLASS =
  "flex items-center gap-3 shrink-0 transition-colors hover:[&_span]:text-amber-200";

export function CatchBrand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className={CATCH_BRAND_LINK_CLASS}>
      <img src="/catch-mark.svg" alt="" className={CATCH_MARK_CLASS} />
      <span className={CATCH_WORDMARK_CLASS}>Catch</span>
    </Link>
  );
}
