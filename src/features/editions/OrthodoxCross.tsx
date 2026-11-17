import styles from "./OrthodoxCross.module.css";

/**
 * The three-bar Orthodox cross, drawn as hairlines: the titulus, the main beam,
 * and the slanted footrest (raised on the viewer's left). "IC XC · NI KA"
 * (Jesus Christ conquers) sits in the quadrants, with titlo marks over the
 * abbreviated Name, inside a thin nimbus. Lines draw themselves in on mount.
 */
export function OrthodoxCross({ className }: { className?: string }) {
  return (
    <svg className={`${styles.cross} ${className ?? ""}`} viewBox="0 0 400 560" role="img" aria-label="Orthodox cross, IC XC NI KA">
      <circle className={styles.nimbus} cx="200" cy="200" r="168" pathLength={1} style={{ "--d": "0ms" } as React.CSSProperties} />
      <g className={styles.beams}>
        <line x1="200" y1="36" x2="200" y2="528" pathLength={1} style={{ "--d": "120ms" } as React.CSSProperties} />
        <line x1="160" y1="112" x2="240" y2="112" pathLength={1} style={{ "--d": "380ms" } as React.CSSProperties} />
        <line x1="64" y1="200" x2="336" y2="200" pathLength={1} style={{ "--d": "460ms" } as React.CSSProperties} />
        <line x1="138" y1="404" x2="262" y2="452" pathLength={1} style={{ "--d": "560ms" } as React.CSSProperties} />
      </g>
      <g className={styles.inscription}>
        <text x="132" y="178">IC</text>
        <text x="268" y="178">XC</text>
        <text x="132" y="250">NI</text>
        <text x="268" y="250">KA</text>
        {/* Titlo: the mark over an abbreviated holy name. */}
        <path d="M112 138h40M112 138v5M152 138v5" />
        <path d="M248 138h40M248 138v5M288 138v5" />
      </g>
    </svg>
  );
}
