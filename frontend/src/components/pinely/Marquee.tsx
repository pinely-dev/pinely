import { tokenCa } from "@/lib/token";
import { shortHex } from "@/lib/machine-view";

export function Marquee() {
  const words = ["EARN", "PAY", "LIMIT", "FREEZE", "BURN"];
  // Repeat to ensure smooth seamless infinite scrolling loop
  const repeated = Array.from({ length: 8 }, () => words).flat();

  return (
    <section className="logos" aria-label="PINELY Protocol actions">
      <small>
        $PINELY · CA: {tokenCa.status === "live" ? shortHex(tokenCa.address, 6, 4) : "TBA"}
      </small>
      <div className="track">
        <div className="row" aria-hidden="true">
          {repeated.map((word, i) => (
            <span key={`${word}-${i}`}>{word}</span>
          ))}
        </div>
      </div>
    </section>
  );
}
