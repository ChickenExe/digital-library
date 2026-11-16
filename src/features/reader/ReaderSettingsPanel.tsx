import type { BookFormat } from "../../bindings/BookFormat";
import {
  FONTS,
  LEADINGS,
  SIZE_MAX,
  SIZE_MIN,
  THEMES,
  useReaderSettings,
  WIDTHS,
  type FontId,
  type ThemeId,
  type WidthId,
} from "./settings";
import styles from "./ReaderSettingsPanel.module.css";

const LEADING_LABELS = ["Compact", "Comfortable", "Airy"];

/** Reading comfort controls. EPUB gets everything; PDFs only theme and page size. */
export function ReaderSettingsPanel({ format, onClose }: { format: BookFormat; onClose: () => void }) {
  const s = useReaderSettings();
  const reflowable = format === "epub";

  return (
    <>
      <div className={styles.scrim} onClick={onClose} />
      <div className={styles.panel} role="dialog" aria-label="Reading settings">
        <Section label="Theme">
          <div className={styles.themes}>
            {(Object.keys(THEMES) as ThemeId[]).map((id) => {
              const t = THEMES[id];
              return (
                <button
                  key={id}
                  className={`${styles.theme} ${s.theme === id ? styles.on : ""}`}
                  style={{ background: t.bg, color: t.text }}
                  onClick={() => s.set({ theme: id })}
                >
                  <span className={styles.sample}>Aa</span>
                  <span className={styles.themeName}>{t.label}</span>
                </button>
              );
            })}
          </div>
        </Section>

        {reflowable && (
          <>
            <Section label="Typeface">
              <div className={styles.fonts}>
                {(Object.keys(FONTS) as FontId[]).map((id) => (
                  <button
                    key={id}
                    className={`${styles.option} ${s.font === id ? styles.on : ""}`}
                    onClick={() => s.set({ font: id })}
                  >
                    <span
                      className={styles.fontSample}
                      style={{ fontFamily: id === "publisher" ? "Georgia, serif" : FONTS[id].family }}
                    >
                      {FONTS[id].label}
                    </span>
                    <span className={styles.note}>{FONTS[id].note}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section label="Size">
              <div className={styles.stepper}>
                <button onClick={() => s.set({ size: Math.max(SIZE_MIN, s.size - 1) })} aria-label="Smaller text">
                  A−
                </button>
                <span>{s.size}px</span>
                <button onClick={() => s.set({ size: Math.min(SIZE_MAX, s.size + 1) })} aria-label="Larger text">
                  A+
                </button>
              </div>
            </Section>

            <Section label="Line spacing">
              <Segmented
                options={LEADINGS.map((l, i) => ({ id: String(l), label: LEADING_LABELS[i] }))}
                value={String(s.leading)}
                onChange={(v) => s.set({ leading: Number(v) as (typeof LEADINGS)[number] })}
              />
            </Section>
          </>
        )}

        <Section label={reflowable ? "Line length" : "Page size"}>
          <Segmented
            options={(Object.keys(WIDTHS) as WidthId[]).map((id) => ({ id, label: WIDTHS[id].label }))}
            value={s.width}
            onChange={(v) => s.set({ width: v as WidthId })}
          />
        </Section>

        {reflowable && (
          <Section label="Layout">
            <Segmented
              options={[
                { id: "paginated", label: "Pages" },
                { id: "scrolled", label: "Scroll" },
              ]}
              value={s.flow}
              onChange={(v) => s.set({ flow: v as "paginated" | "scrolled" })}
            />
          </Section>
        )}
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.label}>{label}</div>
      {children}
    </section>
  );
}

function Segmented(props: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className={styles.segmented}>
      {props.options.map((o) => (
        <button
          key={o.id}
          className={props.value === o.id ? styles.on : ""}
          onClick={() => props.onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
