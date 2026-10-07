import { Link } from "react-router-dom";
import { formatMoney } from "../lib/types";

const STEPS = [
  {
    number: "01",
    title: "Define",
    text: "Create the transaction and define what needs to happen.",
  },
  {
    number: "02",
    title: "Execute",
    text: "Coordinate the transaction across the systems and participants involved.",
  },
  {
    number: "03",
    title: "Verify",
    text: "Capture evidence and verify each important state transition.",
  },
  {
    number: "04",
    title: "Complete",
    text: "Know when the transaction has actually completed successfully.",
  },
];

export default function LandingPage() {
  return (
    <div style={{ background: "var(--canvas)", minHeight: "100vh" }}>
      <header className="landing-nav">
        <div className="landing-container landing-nav-inner" style={{ padding: 0 }}>
          <div>
            <span style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Nobryn</span>
          </div>
          <nav className="landing-links" aria-label="Landing navigation">
            <a href="#product" className="text-muted" style={{ fontSize: 14 }}>
              Product
            </a>
            <a href="#how-it-works" className="text-muted" style={{ fontSize: 14 }}>
              How it works
            </a>
            <Link to="/login" className="text-muted" style={{ fontSize: 14 }}>
              Log in
            </Link>
            <Link to="/register" className="btn btn-primary" style={{ height: 36 }}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="landing-container">
        {/* Hero */}
        <section className="landing-hero">
          <h1>Business transactions, executed reliably.</h1>
          <p className="support">
            Nobryn provides infrastructure for executing, monitoring, and verifying multi-party
            business transactions across the systems businesses already use.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
            <Link to="/register" className="btn btn-primary">
              Get started
            </Link>
            <a href="#how-it-works" className="btn btn-secondary">
              See how it works
            </a>
          </div>
        </section>

        {/* How it works */}
        <section className="landing-section" id="how-it-works">
          <h2 className="section-heading">From business intent to verified completion.</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))",
              gap: 16,
              marginTop: 24,
            }}
          >
            {STEPS.map((step) => (
              <div key={step.number} className="card card-pad">
                <div className="text-12 mono" style={{ color: "var(--bio-black)", fontWeight: 600 }}>
                  {step.number}
                </div>
                <h3 className="card-heading" style={{ marginTop: 8 }}>
                  {step.title}
                </h3>
                <p className="text-muted" style={{ margin: "8px 0 0 0", fontSize: 14 }}>
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Example lifecycle */}
        <section className="landing-section" id="product">
          <h2 className="section-heading">What a transaction looks like in Nobryn.</h2>
          <p className="section-sub" style={{ maxWidth: 640 }}>
            Every transaction carries its own execution state, evidence, and exceptions.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))",
              gap: 16,
              marginTop: 24,
            }}
          >
            <div className="card card-pad">
              <div className="text-12" style={{ color: "#647067", fontWeight: 500 }}>
                Purchase Order #PO-10482
              </div>
              <div className="text-12" style={{ color: "#8E9892", marginTop: 4, letterSpacing: "0.02em" }}>
                ACME INDUSTRIAL → GLOBAL COMPONENTS
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, marginTop: 12 }} className="mono">
                {formatMoney(184500, "USD")}
              </div>
              <ol style={{ listStyle: "none", padding: 0, margin: "20px 0 0 0", display: "flex", flexDirection: "column", gap: 10 }}>
                <LifecycleRow label="Created" done />
                <LifecycleRow label="Accepted" done />
                <LifecycleRow label="Fulfilling" current />
                <LifecycleRow label="Delivered" />
                <LifecycleRow label="Completed" />
              </ol>
            </div>
            <div className="card card-pad">
              <div
                className="badge badge-warning"
                style={{ marginBottom: 12 }}
              >
                <span className="dot" aria-hidden />
                Quantity mismatch
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ExampleMeta label="Expected" value="500 units" />
                <ExampleMeta label="Received" value="470 units" />
                <ExampleMeta label="Difference" value="-30 units" />
                <ExampleMeta label="Status" value="OPEN" />
                <ExampleMeta label="Next action" value="Supplier confirmation required" />
              </div>
            </div>
          </div>
        </section>

        {/* Positioning */}
        <section className="landing-section" style={{ paddingBottom: 80 }}>
          <h2 className="section-heading">Infrastructure for business transactions.</h2>
          <p className="section-sub" style={{ maxWidth: 680 }}>
            Nobryn works across the systems, organizations, and people involved in a transaction,
            giving businesses a reliable execution state and evidence of what actually happened.
          </p>
          <div style={{ marginTop: 32 }}>
            <Link to="/register" className="btn btn-primary">
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <div className="landing-container">Nobryn</div>
      </footer>
    </div>
  );
}

function LifecycleRow({ label, done, current }: { label: string; done?: boolean; current?: boolean }) {
  return (
    <li style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 9999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 600,
          border: done ? "1px solid #15803D" : current ? "1px solid #06110D" : "1px solid #D9E0DC",
          background: done ? "#15803D" : current ? "#C8FF00" : "#FFFFFF",
          color: done ? "#FFFFFF" : current ? "#06110D" : "#8E9892",
        }}
      >
        {done ? "✓" : current ? "●" : ""}
      </span>
      <span style={{ color: done ? "#15803D" : current ? "#06110D" : "#647067", fontWeight: current ? 600 : 400 }}>
        {label}
      </span>
    </li>
  );
}

function ExampleMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: "1px solid #D9E0DC", paddingBottom: 10 }}>
      <span className="text-12" style={{ color: "#647067" }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{value}</span>
    </div>
  );
}
