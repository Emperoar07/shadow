import { ReactNode } from "react";

interface V2BadgeProps {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "info";
}

const toneClass: Record<NonNullable<V2BadgeProps["tone"]>, string> = {
  default: "border-shadow-500 bg-shadow-700/70 text-gray-300",
  success: "border-accent-green/30 bg-accent-green/10 text-accent-green",
  warning: "border-yellow-400/30 bg-yellow-400/10 text-yellow-300",
  info: "border-accent-purple/30 bg-accent-purple/10 text-accent-purple",
};

export default function V2Badge({ children, tone = "default" }: V2BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
