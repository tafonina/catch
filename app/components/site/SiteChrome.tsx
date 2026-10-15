import Link from "next/link";
import { CatchBrand } from "@/components/CatchMark";

export function SiteChrome({
  children,
  active,
  edition,
}: {
  children: React.ReactNode;
  active?: "home" | "docs";
  edition?: "classic";
}) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#05070b]/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <CatchBrand />
          <nav className="flex items-center gap-5 text-sm">
            <Link
              href="/docs"
              className={active === "docs" ? "text-[#e7c96a]" : "text-slate-300 hover:text-white"}
            >
              Docs
            </Link>
            <Link
              href="/app"
              className="rounded-full bg-[#d4af37] px-4 py-2 font-semibold text-black transition hover:bg-[#e3c25a]"
            >
              Open app
            </Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-8 text-sm text-slate-500 sm:px-6">
          <div>Catch · devnet · not offered to US persons</div>
          <div className="flex gap-5">
            {edition === "classic" ? (
              <Link href="/" className="hover:text-slate-200">
                Newer landing
              </Link>
            ) : active === "home" ? (
              <Link href="/classic" className="hover:text-slate-200">
                Earlier landing
              </Link>
            ) : null}
            <Link href="/docs" className="hover:text-slate-200">
              Docs
            </Link>
            <Link href="/app" className="hover:text-slate-200">
              App
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
