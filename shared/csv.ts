export type CsvCell = string | number | boolean | null | undefined;

/**
 * Spreadsheet apps run a text cell that starts with `=`, `+`, `-`, `@`, tab or carriage return as a
 * formula (CSV injection). Prefixing an apostrophe makes them show it as plain text instead.
 * Numbers are never prefixed, so negative amounts stay numeric.
 */
function neutraliseFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function encodeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  const text = typeof cell === "string" ? neutraliseFormula(cell) : String(cell);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** RFC 4180 CSV: CRLF line endings, quotes doubled, fields with commas/quotes/newlines quoted. */
export function toCsv(rows: CsvCell[][]): string {
  return rows.map((row) => row.map(encodeCell).join(",")).join("\r\n") + "\r\n";
}
