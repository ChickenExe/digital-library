import { Component, type ErrorInfo, type ReactNode } from "react";

type State = { error: Error | null };

/** Last line of defence: a crash shows a recoverable screen instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 48, fontFamily: "var(--font-ui)", maxWidth: 760 }}>
        <div className="mono" style={{ color: "var(--color-red)" }}>
          Something went wrong
        </div>
        <h1 style={{ fontSize: 56, fontWeight: 900, letterSpacing: "-0.04em", margin: "16px 0" }}>Folio hit a snag.</h1>
        <pre className="mono" style={{ whiteSpace: "pre-wrap", textTransform: "none", color: "var(--color-text-muted)" }}>
          {error.message}
          {"\n"}
          {error.stack?.split("\n").slice(0, 6).join("\n")}
        </pre>
        <button className="btn btn-ink btn-lg" style={{ marginTop: 24 }} onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
