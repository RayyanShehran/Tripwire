import type { ReactNode } from "react";
export function SectionPanel({ children, className = "", eyebrow, title }: { children: ReactNode; className?: string; eyebrow?: string; title: string }) {
  return <section className={`section-panel ${className}`}><header>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2>{title}</h2></header>{children}</section>;
}
