import { ReactNode } from "react";

interface V2PanelProps {
  enabled: boolean;
  className?: string;
  children: ReactNode;
}

export default function V2Panel({ enabled, className = "", children }: V2PanelProps) {
  if (!enabled) {
    return <>{children}</>;
  }

  return (
    <div
      className={`rounded-xl border border-shadow-600/70 bg-[#0f1420]/40 p-2 transition-colors ${className}`}
    >
      {children}
    </div>
  );
}
