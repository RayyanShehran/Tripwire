import type { ButtonHTMLAttributes, ReactNode } from "react";
type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost" };
export function ActionButton({ children, className = "", icon, variant = "secondary", ...props }: ActionButtonProps) {
  return <button className={`button button-${variant} ${className}`} type="button" {...props}>
    {icon ? <span aria-hidden="true">{icon}</span> : null}{children}
  </button>;
}
