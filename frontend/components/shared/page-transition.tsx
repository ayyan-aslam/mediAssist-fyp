"use client";

import { motion } from "motion/react";

// Soft fade and slide when a page opens. MotionConfig (in Providers) turns it off
// when the user prefers reduced motion.
export function PageTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
