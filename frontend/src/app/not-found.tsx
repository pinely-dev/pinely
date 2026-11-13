import type { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/pinely/Navbar";
import { Footer } from "@/components/pinely/Footer";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
  // A 404 has no canonical: the root layout's "./" would resolve to the internal /_not-found path.
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <div className="frame">
      <Navbar />
      <main id="main-content">
        <section
          className="sec"
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "55vh",
            paddingTop: "64px",
          }}
        >
          <div
            className="card feat"
            style={{
              maxWidth: "520px",
              width: "100%",
              padding: "36px 30px",
              height: "auto",
              gap: "14px",
              textAlign: "center",
              alignItems: "center",
            }}
          >
            <span className="tag" style={{ background: "rgba(0,0,0,0.5)" }}>
              Error 404
            </span>
            <h1 style={{ fontSize: "36px", margin: "8px 0" }}>Page Not Found</h1>
            <p style={{ color: "#f0dde2", fontSize: "15px", lineHeight: 1.5 }}>
              The requested machine route does not exist or has been relocated on Robinhood Chain.
            </p>
            <div style={{ marginTop: "12px" }}>
              <Link href="/" className="btn dark">
                Return to Home
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
