/**
 * Motion tokens: one vocabulary for every tween in the app.
 *
 * The Index aesthetic is Swiss and editorial, so motion is too: fast to start,
 * long to settle (expo-out), axis-true (things slide along the grid rather than
 * wobble), masked reveals for type, hairlines that draw, pills that travel and
 * tilted cards that are "dealt". No bouncy overshoot anywhere.
 */
import type { Transition, Variants } from "motion/react";

type Bezier = [number, number, number, number];

export const EASE: Record<"out" | "inOut" | "in", Bezier> = {
  /** The house curve: quick start, long settle. */
  out: [0.16, 1, 0.3, 1],
  inOut: [0.65, 0, 0.35, 1],
  in: [0.7, 0, 0.84, 0],
};

export const DUR = { micro: 0.14, fast: 0.22, base: 0.42, slow: 0.7 } as const;

export const SPRING = {
  /** Pills and indicators: critically damped, no overshoot. */
  pill: { type: "spring", stiffness: 520, damping: 44, mass: 0.9 } as Transition,
  /** Panels and sheets. */
  panel: { type: "spring", stiffness: 360, damping: 40 } as Transition,
  /** Shared-element cover morphs. */
  morph: { type: "spring", stiffness: 300, damping: 34 } as Transition,
};

export const tween = (duration: number = DUR.base, delay = 0): Transition => ({
  duration,
  delay,
  ease: EASE.out,
});

/** Fade + rise: the default way content arrives. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: tween(DUR.base) },
};

/** Container that staggers its motion children. */
export const stagger = (each = 0.05, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: each, delayChildren: delay } },
});

/** Section order, so page transitions know which way to slide. */
export const SECTION_ORDER = { home: 0, discover: 1, collection: 2, circles: 3 } as const;

/** Directional page transition (custom = +1 forward, -1 back). */
export const page: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 64 }),
  center: { opacity: 1, x: 0, transition: tween(DUR.base + 0.08) },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir * -40,
    transition: { duration: DUR.fast, ease: EASE.in },
  }),
};

export const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
