import { useEffect, useState } from "react";
import { prefersReducedMotion } from "../../lib/motion";

const GLYPHS = "0123456789#/—*+";

/**
 * Mono labels "decode" into place on mount: characters resolve left to right
 * through a few random glyphs. A small, technical flourish for section labels.
 */
export function Scramble({ text, duration = 420, delay = 0 }: { text: string; duration?: number; delay?: number }) {
  const [out, setOut] = useState(() => (prefersReducedMotion() ? text : text.replace(/\S/g, " ")));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setOut(text);
      return;
    }
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const resolved = Math.floor(t * text.length);
      setOut(
        [...text]
          .map((ch, i) => {
            if (i < resolved || ch === " ") return ch;
            if (now < start) return " ";
            return GLYPHS[(i * 7 + Math.floor(now / 40)) % GLYPHS.length];
          })
          .join(""),
      );
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, duration, delay]);

  return <span aria-label={text}>{out}</span>;
}
