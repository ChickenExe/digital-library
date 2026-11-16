import { AnimatePresence, motion } from "motion/react";
import { EASE } from "../../lib/motion";
import styles from "./MaskNumber.module.css";

type Props = {
  /** Text to show, e.g. "007". Each character animates independently. */
  value: string;
  /** Characters before this index render as outlined "ghost" digits. */
  ghostBefore?: number;
  className?: string;
  ghostClassName?: string;
  /** Delay before the first digit rises (seconds). */
  delay?: number;
};

/**
 * Digits that rise out of a mask, one after another, like type set into a
 * frame. When the value changes, only the changed digits roll.
 */
export function MaskNumber({ value, ghostBefore = 0, className, ghostClassName, delay = 0 }: Props) {
  const chars = [...value];
  return (
    <span className={`${styles.number} ${className ?? ""}`} aria-label={value}>
      {chars.map((ch, i) => (
        <span key={`${chars.length}-${i}`} className={styles.slot} aria-hidden>
          <AnimatePresence initial={true} mode="popLayout">
            <motion.span
              key={ch}
              className={`${styles.digit} ${i < ghostBefore ? (ghostClassName ?? "") : ""}`}
              initial={{ y: "105%" }}
              animate={{ y: "0%", transition: { duration: 0.9, delay: delay + i * 0.07, ease: EASE.out } }}
              exit={{ y: "-60%", opacity: 0, transition: { duration: 0.25, ease: EASE.in } }}
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  );
}
