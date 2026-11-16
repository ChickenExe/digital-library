import { useEffect, useState } from "react";
import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from "motion/react";
import { EASE } from "../../lib/motion";

/** A number that tweens from its previous value (or 0 on mount) to the new one. */
export function CountUp({ value, duration = 0.9, delay = 0 }: { value: number; duration?: number; delay?: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const [shown, setShown] = useState(mv.get());
  useMotionValueEvent(mv, "change", (v) => setShown(Math.round(v)));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, delay, ease: EASE.out });
    return () => controls.stop();
  }, [mv, value, duration, delay, reduce]);

  return <>{shown.toLocaleString()}</>;
}
