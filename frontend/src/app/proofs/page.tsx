import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { robinhoodMainnet } from "@pinely/shared/chains";
import { findContractAddress } from "@pinely/shared/contracts";
import { PROOFS, type ProofStatus } from "@pinely/shared/proofs";

const STATUS_LABEL: Record<ProofStatus, string> = {
  pending: "PENDING",
  proven: "PROVEN",
  blocked: "BLOCKED",
};

export default function ProofsPage() {
  const explorer = robinhoodMainnet.blockExplorers.default.url;
  const registry =
    findContractAddress(robinhoodMainnet.id, "MachineRegistry") ?? "<MachineRegistry address>";

  return (
    <div className="frame">
      <PageBackground word="PROOFS" variant="reading" />
      <Navbar />
      <main id="main-content">
        <section className="ph ph-haze ph-haze-docs page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Proofs
          </span>
          <h1>Claims we owe you a transaction for.</h1>
          <p>
            Each card is one claim, how to check it, and where it stands. A proof is only marked
            proven when its mainnet transaction hashes are listed here. A proof that fails stays on
            this page with the reason.
          </p>
        </section>

        <section className="sec" style={{ paddingTop: "24px" }}>
          <div className="grid">
            {PROOFS.map((proof) => {
              const proven = proof.status === "proven";
              return (
                <article className="card" key={proof.id}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "10px",
                      flexWrap: "wrap",
                    }}
                  >
                    <span className="text-xs text-crimson-400">Proof {proof.id}</span>
                    <span className={`status-pill ${proven ? "active" : "standby"}`}>
                      <span className={`pulse-beacon ${proven ? "green" : "red"}`} />
                      <span>{STATUS_LABEL[proof.status]}</span>
                    </span>
                  </div>
                  <h2 style={{ fontSize: "18px", margin: "10px 0 6px" }}>{proof.title}</h2>
                  <p className="note" style={{ lineHeight: 1.5, margin: 0 }}>
                    {proof.claim}
                  </p>

                  <dl className="fact-list" style={{ marginTop: "14px" }}>
                    <div>
                      <dt>Date</dt>
                      <dd>{proof.date ?? "Not run yet"}</dd>
                    </div>
                    <div>
                      <dt>Transactions</dt>
                      <dd className="font-mono">
                        {proof.txHashes.length === 0
                          ? "None yet"
                          : proof.txHashes.map((hash) => (
                              <a
                                key={hash}
                                href={`${explorer}/tx/${hash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: "block", textDecoration: "underline" }}
                              >
                                {hash}
                              </a>
                            ))}
                      </dd>
                    </div>
                    {proof.reason ? (
                      <div>
                        <dt>Why it is blocked</dt>
                        <dd>{proof.reason}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>How to check</dt>
                      <dd>
                        <pre className="verify-block font-mono" tabIndex={0}>
                          {proof.checks
                            .map((line) => line.replace("{registry}", registry))
                            .join("\n")}
                        </pre>
                      </dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
