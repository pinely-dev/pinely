import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { tokenCa } from "@/lib/token";
import { X_HANDLE, X_URL } from "@/lib/site";
import { STATUS_AS_OF } from "@pinely/shared/status";

export default function LegalPage() {
  return (
    <div className="frame">
      <PageBackground word="LEGAL" variant="reading" />
      <Navbar />
      <main id="main-content">
        <section className="ph ph-haze ph-haze-legal">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Legal
          </span>
          <h1>Terms, privacy, and risk.</h1>
          <p>Draft placeholders. Entity name and jurisdiction are to be supplied by the owner.</p>
          <p className="note" style={{ marginTop: "12px" }}>
            Last updated {STATUS_AS_OF}. Contact:{" "}
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: "44px",
                textDecoration: "underline",
              }}
            >
              {X_HANDLE} on X
            </a>
            .
          </p>
        </section>

        <section className="sec" style={{ paddingTop: "32px" }}>
          <div className="grid">
            <div className="card">
              <h2>Terms of use</h2>
              <p>
                To be formalized for the registered entity. Covers open-source software licensing,
                protocol interaction, and operator obligations.
              </p>
            </div>

            <div className="card">
              <h2>Privacy policy</h2>
              <p>
                Machine addresses and telemetry verifications are recorded publicly on the
                blockchain without personal off-chain identifiers.
              </p>
            </div>

            <div className="card hl">
              <h2>Risk disclosure</h2>
              <p>
                $PINELY is live on Robinhood Chain at{" "}
                {tokenCa.status === "live" ? (
                  <span className="font-mono" style={{ overflowWrap: "anywhere" }}>
                    {tokenCa.address}
                  </span>
                ) : (
                  "an address that is not configured on this site"
                )}
                . Its price can go to zero. PINELY smart contracts have not been externally audited.
                Stage 2 features (staking, burn, fee tiers) are deployed but not in use yet, and may
                change or never be used. Nothing on this site is investment, legal or tax advice.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
