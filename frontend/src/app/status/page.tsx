import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import {
  platformStatus,
  STATUS_AS_OF,
  type StatusId,
  type StatusLevel,
} from "@pinely/shared/status";

/** The order the brief lists the rows in. */
const ORDER: StatusId[] = [
  "stage1-mainnet",
  "token",
  "userop-mainnet",
  "indexer-mainnet",
  "stage2",
  "audit",
  "hardware-keys",
  "spend-cap-onchain",
];

const LEVEL_LABEL: Record<StatusLevel, string> = {
  live: "LIVE",
  pending: "PENDING",
  "not-deployed": "NOT DEPLOYED",
  planned: "PLANNED",
  none: "NONE",
};

export default function StatusPage() {
  return (
    <div className="frame">
      <PageBackground word="STATUS" variant="reading" />
      <Navbar />
      <main id="main-content">
        <section className="ph ph-haze ph-haze-docs page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Status
          </span>
          <h1>What is live, and what is not.</h1>
          <p>
            One table, read from the same source as the badges and the roadmap on every page, so
            they cannot disagree. Rows from the address book change by themselves when an address is
            added; the rest are checked by hand, last on {STATUS_AS_OF}.
          </p>
        </section>

        <section className="sec" style={{ paddingTop: "24px" }}>
          <div className="tw" role="region" aria-label="Platform status table" tabIndex={0}>
            <table className="tbl font-mono">
              <thead>
                <tr>
                  <th scope="col">Component</th>
                  <th scope="col">Status</th>
                  <th scope="col">Detail</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {ORDER.map((id) => {
                  const entry = platformStatus[id];
                  const live = entry.level === "live";
                  return (
                    <tr key={id}>
                      <td>
                        <strong style={{ color: "#ffffff" }}>{entry.label}</strong>
                      </td>
                      <td>
                        <span className={`status-pill ${live ? "active" : "standby"}`}>
                          <span className={`pulse-beacon ${live ? "green" : "red"}`} />
                          <span>{LEVEL_LABEL[entry.level]}</span>
                        </span>
                      </td>
                      <td style={{ color: "var(--mut-light)", fontSize: "12px", lineHeight: 1.5 }}>
                        {entry.detail}
                      </td>
                      <td style={{ color: "var(--mut-light)", fontSize: "12px" }}>
                        {entry.source === "derived"
                          ? "Address book"
                          : `Checked by hand, ${STATUS_AS_OF}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
