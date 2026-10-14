export function Eq({
  children,
  caption,
}: {
  children: React.ReactNode;
  caption?: string;
}) {
  return (
    <figure className="my-6 overflow-x-auto rounded-2xl border border-[rgba(212,175,55,0.16)] bg-[#080b11] px-4 py-6 sm:px-8">
      <div className="flex min-w-max items-center justify-center text-[1.05rem] leading-snug text-slate-100 sm:text-xl">
        {children}
      </div>
      {caption ? (
        <figcaption className="mt-4 text-center text-xs leading-relaxed text-slate-500">{caption}</figcaption>
      ) : null}
    </figure>
  );
}

export function Frac({ num, den }: { num: React.ReactNode; den: React.ReactNode }) {
  return (
    <span className="mx-1.5 inline-flex flex-col items-stretch justify-center align-middle text-[0.92em] leading-tight">
      <span className="px-1.5 pb-1 text-center">{num}</span>
      <span className="h-px bg-white/70" />
      <span className="px-1.5 pt-1 text-center">{den}</span>
    </span>
  );
}

export function V({ children }: { children: React.ReactNode }) {
  return <span className="serif italic tracking-tight text-[#f3e6c0]">{children}</span>;
}

export function Sub({ children }: { children: React.ReactNode }) {
  return (
    <sub className="ml-px font-sans text-[0.62em] not-italic tracking-normal text-slate-300">
      {children}
    </sub>
  );
}

export function Cases({
  lines,
}: {
  lines: { expr: React.ReactNode; when: string }[];
}) {
  return (
    <span className="inline-flex items-center gap-3">
      <span className="serif text-5xl font-light leading-none text-slate-500">{"{"}</span>
      <span className="flex flex-col items-start gap-4 text-left text-base sm:text-[1.05rem]">
        {lines.map((line) => (
          <span key={line.when} className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span>{line.expr}</span>
            <span className="text-sm text-slate-500">{line.when}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
