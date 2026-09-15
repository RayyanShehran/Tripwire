import type { ButtonHTMLAttributes, ReactNode } from "react";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

export function ActionButton({
  children,
  className = "",
  icon,
  variant = "secondary",
  ...props
}: ActionButtonProps) {
  const variants = {
    primary:
      "border-cyan-400/70 bg-cyan-400 text-slate-950 hover:bg-cyan-300 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500",
    secondary:
      "border-slate-700 bg-slate-900 text-slate-100 hover:border-slate-500 hover:bg-slate-800 disabled:text-slate-500",
    danger:
      "border-red-500/80 bg-red-500 text-white hover:bg-red-400 disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500",
    ghost:
      "border-slate-700 bg-transparent text-slate-300 hover:border-slate-500 hover:text-white disabled:text-slate-600",
  };

  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      type="button"
      {...props}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </button>
  );
}
