import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./VirtualGrid.module.css";

type Props<T> = {
  items: T[];
  getKey: (item: T) => string;
  render: (item: T, index: number) => ReactNode;
  /** Columns are at least this wide; extra space is shared between them. */
  minColumnWidth: number;
  /** Card height for a given column width (cards have fixed proportions). */
  itemHeight: (columnWidth: number) => number;
  gap: { row: number; column: number };
  padding: { x: number; top: number; bottom: number };
  /** Rendered above the grid, inside the same scroll container. */
  header?: ReactNode;
  /** Called when the user scrolls within ~2 screens of the end (infinite scroll). */
  onEndReached?: () => void;
  /** Rows rendered beyond the viewport in each direction. */
  overscan?: number;
  className?: string;
};

/**
 * A windowed grid: only the rows near the viewport exist in the DOM. Scrolling
 * a 10,000-book library costs the same as scrolling 30 books, and covers that
 * scroll far away are unmounted, so their decoded images can be freed.
 */
export function VirtualGrid<T>(props: Props<T>) {
  const { items, getKey, render, minColumnWidth, itemHeight, gap, padding, header, onEndReached, overscan = 2 } = props;
  const scroller = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [headerHeight, setHeaderHeight] = useState(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setViewport({ top: el.scrollTop, height: el.clientHeight });
      setHeaderHeight(headerRef.current?.offsetHeight ?? 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (headerRef.current) ro.observe(headerRef.current);
    return () => ro.disconnect();
  }, []);

  // Scroll updates are coalesced to one per frame.
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = scroller.current;
      if (el) setViewport({ top: el.scrollTop, height: el.clientHeight });
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const inner = Math.max(0, width - padding.x * 2);
  const columns = Math.max(1, Math.floor((inner + gap.column) / (minColumnWidth + gap.column)));
  const colWidth = (inner - gap.column * (columns - 1)) / columns;
  const rowHeight = itemHeight(colWidth) + gap.row;
  const rows = Math.ceil(items.length / columns);
  const gridHeight = rows * rowHeight - (rows > 0 ? gap.row : 0);

  const gridTop = headerHeight + padding.top;
  const first = Math.max(0, Math.floor((viewport.top - gridTop) / rowHeight) - overscan);
  const last = Math.min(rows - 1, Math.ceil((viewport.top + viewport.height - gridTop) / rowHeight) + overscan);

  useEffect(() => {
    if (!onEndReached || rows === 0) return;
    const remaining = gridTop + gridHeight - (viewport.top + viewport.height);
    if (remaining < viewport.height * 2) onEndReached();
  }, [viewport, gridTop, gridHeight, rows, onEndReached]);

  const cells: ReactNode[] = [];
  if (width > 0) {
    for (let row = first; row <= last; row++) {
      for (let col = 0; col < columns; col++) {
        const index = row * columns + col;
        if (index >= items.length) break;
        const item = items[index];
        cells.push(
          <div
            key={getKey(item)}
            className={styles.cell}
            // Plain top/left (not transforms): transformed cells can each get their own
            // compositing layer, which costs a lot of (GPU) memory across hundreds of cells.
            style={{
              left: padding.x + col * (colWidth + gap.column),
              top: row * rowHeight,
              width: colWidth,
              height: rowHeight - gap.row,
            }}
          >
            {render(item, index)}
          </div>,
        );
      }
    }
  }

  return (
    <div ref={scroller} className={`${styles.scroller} ${props.className ?? ""}`} onScroll={onScroll}>
      {header && <div ref={headerRef}>{header}</div>}
      <div className={styles.grid} style={{ height: gridHeight + padding.top + padding.bottom, paddingTop: padding.top }}>
        <div className={styles.canvas} style={{ top: padding.top }}>
          {cells}
        </div>
      </div>
    </div>
  );
}
