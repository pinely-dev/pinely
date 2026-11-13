import { toCsv } from "@pinely/shared/csv";
import { fetchMachinesList, toStable, type BackendMachine } from "./api";
import { tierOf } from "./machine-view";
import { stablecoinSymbol } from "@/lib/chain";

const PAGE_SIZE = 100;
/** Hard stop so a misbehaving API can never keep the loop running forever. */
const MAX_PAGES = 200;

/** Loads every machine of an operator, page by page, so the export is never silently truncated. */
export async function fetchAllOperatorMachines(operator: string): Promise<BackendMachine[]> {
  const all: BackendMachine[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchMachinesList(page, PAGE_SIZE, { operator });
    all.push(...res.data);
    const total = res.meta.total ?? all.length;
    if (res.data.length === 0 || all.length >= total) break;
  }
  return all;
}

const HEADER = [
  "Machine ID",
  "Account",
  "Session Key",
  "Operator",
  "Reputation Tier",
  "Fee Tier",
  `Daily Used (${stablecoinSymbol})`,
  `Daily Cap (${stablecoinSymbol})`,
  `Per-Swap Cap (${stablecoinSymbol})`,
  "Policy Enabled",
  "Status",
  "Violations",
  "Registered (UTC)",
];

function isoTime(seconds: number | string | null | undefined): string {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : "";
}

/** Builds the fleet ledger CSV from indexer data. Nothing here is invented or estimated. */
export function buildFleetCsv(machines: BackendMachine[]): string {
  const rows = machines.map((m) => {
    const tier = tierOf(m.tier);
    return [
      m.machineId ?? m.id ?? "",
      m.account,
      m.signer,
      m.operator,
      tier.name,
      tier.fee,
      toStable(m.usedToday),
      toStable(m.dailyStableOutCap),
      toStable(m.maxStableOutPerSwap),
      m.policyEnabled,
      m.frozen ? "Frozen" : "Active",
      Number(m.violations ?? 0),
      isoTime(m.registeredAt),
    ];
  });
  return toCsv([HEADER, ...rows]);
}

/** Starts a browser download for `csv`. The object URL is released right after the click. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
