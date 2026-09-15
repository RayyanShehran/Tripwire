import type { ReactNode } from "react";

type SectionPanelProps = {
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  title: string;
};

export function SectionPanel({
  children,
  className = "",
  eyebrow,
  title,
}: SectionPanelProps) {
  return (
    <section className={`rounded-md border border-slate-800 bg-slate-950/75 ${className}`}>
      <div className="border-b border-slate-800 px-4 py-3">
        {eyebrow ? (
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
