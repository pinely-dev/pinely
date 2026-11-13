import { stablecoinSymbol } from "@/lib/chain";
/**
 * Protocol pricing. Every figure is a parameter of the deployed code, and each row says whether it
 * is charged today:
 *
 * - Registration: `DeployBase.s.sol` (`DEFAULT_REGISTRATION_FEE`, 2 stablecoin unless the deployer
 *   overrides `REGISTRATION_FEE`), collected by `MachineRegistry` in Stage 1.
 * - Protocol fee and tier fees: `PinelyHook.sol` (`PROTOCOL_FEE_BPS`, `FEE_BRONZE/SILVER/GOLD`), Stage 2.
 * - Facilitator fee: backend `FACILITATOR_FEE_BPS` (10 = 0.1%), applied only when a fee recipient is set.
 * - SDK and Fleet Pro: `FleetSubscription.sol` (`SDK_DEVICE_MONTHLY_RATE`, `FLEET_PRO_MONTHLY_RATE`).
 *   That contract is not part of Stage 1 and nothing bills these plans yet.
 */
interface PriceRow {
  item: string;
  price: string;
  basis: string;
  status: string;
}

const ROWS: PriceRow[] = [
  {
    item: "Machine registration",
    price: `2 ${stablecoinSymbol}`,
    basis: "Once per machine, paid by the operator. Default; set when the registry is deployed.",
    status: "Charged in Stage 1",
  },
  {
    item: "Swap fee by tier",
    price: "0.30% / 0.15% / 0.05%",
    basis: "Bronze / Silver / Gold, charged on each machine swap in the pool.",
    status: "Stage 2: testnet rehearsal",
  },
  {
    item: "Protocol fee",
    price: "0.05%",
    basis: `Of the ${stablecoinSymbol} a machine swaps out, on top of the tier fee.`,
    status: "Stage 2: testnet rehearsal",
  },
  {
    item: "Facilitator fee",
    price: "0.1%",
    basis:
      "Of each machine payment; the provider receives the amount minus the fee. Applies only when the Facilitator operator sets a fee recipient.",
    status: "Set by the Facilitator operator",
  },
  {
    item: "PINELY SDK",
    price: `1 ${stablecoinSymbol}`,
    basis: "Per active device per month.",
    status: "Contract ready; billing not live",
  },
  {
    item: "Fleet Pro",
    price: `99 ${stablecoinSymbol}`,
    basis: "Per fleet per month.",
    status: "Contract ready; billing not live",
  },
];

export function PricingTable() {
  return (
    <div style={{ marginTop: "18px" }}>
      <div className="sh">
        <span className="tag">
          <b className="dot" aria-hidden="true" /> Protocol Pricing
        </span>
        <h2>What it costs.</h2>
        <p>
          You pay per machine and per transaction, never for token hype. These are the current
          parameters of the contracts; the last column says what is charged today.
        </p>
      </div>

      <div className="tw" role="region" aria-label="Plans and pricing table" tabIndex={0}>
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Price</th>
              <th scope="col">Basis</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.item}>
                <td style={{ fontWeight: 600, color: "#ffffff" }}>{row.item}</td>
                <td>{row.price}</td>
                <td>{row.basis}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="note" style={{ marginTop: "12px" }}>
        Where the BurnVault exists, 20% of registration, subscription and protocol-fee income is
        routed to it for burning; it does not exist in Stage 1.
      </p>
    </div>
  );
}
