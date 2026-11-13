import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";

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
        </section>

        <section className="sec" style={{ paddingTop: "32px" }}>
          <div className="grid">
            <div className="card">
              <h2>Terms of use</h2>
              <p>
                To be formalized for the registered entity. Covers open-source software licensing,
                non-custodial protocol interaction, and operator obligations.
              </p>
            </div>

            <div className="card">
              <h2>Privacy policy</h2>
              <p>
                Non-custodial by design. Machine addresses and telemetry verifications are recorded
                publicly on the blockchain without personal off-chain identifiers.
              </p>
            </div>

            <div className="card hl">
              <h2>Risk disclosure</h2>
              <p>
                Smart contracts are undergoing testing and have not yet completed formal external
                audit. $PINELY has not launched. Network parameters may change.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
