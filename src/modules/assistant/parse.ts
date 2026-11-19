/** Pure text helpers for the assistant, kept apart from the server-only service so they can be unit tested. */

/** A document number anywhere in the text: SO-00057, "PO 12", INV-00087. */
export const NUMBER_RE = /\b(SO|PO|WO|INV|Q|SH|BILL|NCR|CAPA|CM|RC)-?(\d{3,6})\b/i;

/** An amount in the text, ignoring the digits of document numbers ("pay BILL-00012" has no amount). */
export function parseMoney(s: string): number | null {
  const m = s.replace(new RegExp(NUMBER_RE.source, "gi"), " ").match(/\$?\s*(\d[\d,]*(?:\.\d+)?)/);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
