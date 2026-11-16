import { useEffect, useRef, useState } from "react";
import { EASE, prefersReducedMotion } from "../../lib/motion";

/** Cubic-bezier easing via a few Newton steps (avoids pulling in an animation engine). */
function bezier([x1, y1, x2, y2]: [number, number, number, number]) {
  const curve = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 * t + 3 * b * (1 - t) * t ** 2 + t ** 3;
  const slope = (a: number, b: number, t: number) => 3 * a * (1 - t) ** 2 + 6 * (b - a) * (1 - t) * t + 3 * (1 - b) * t ** 2;
  return (x: number) => {
    let t = x;
    for (let i = 0; i < 6; i++) {
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-6) break;
      t -= (curve(x1, x2, t) - x) / d;
    }
    return curve(y1, y2, Math.min(1, Math.max(0, t)));
  };
}
const easeOut = bezier(EASE.out);

/** A number that tweens from its previous value (or 0 on mount) to the new one. */
export function CountUp({ value, duration = 0.9, delay = 0 }: { value: number; duration?: number; delay?: number }) {
  const reduce = prefersReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now() + delay * 1000;
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / (duration * 1000)));
      const v = Math.round(a + (value - a) * easeOut(t));
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, delay, reduce]);

  return <>{shown.toLocaleString()}</>;
}
