import { ReactNode } from "react";
import { motion } from "framer-motion";

interface V2SectionMotionProps {
  enabled: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}

export default function V2SectionMotion({
  enabled,
  delay = 0,
  className,
  children,
}: V2SectionMotionProps) {
  if (!enabled) {
    return <section className={className}>{children}</section>;
  }

  return (
    <motion.section
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay, ease: "easeOut" }}
    >
      {children}
    </motion.section>
  );
}
