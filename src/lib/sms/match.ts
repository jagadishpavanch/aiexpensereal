/** Indian DLT sender ids: optional 2-letter route prefix, a 6-character header, optional type suffix ("VM-HDFCBK", "AX-ICICIB-S"). */
const DLT = /^(?:[A-Z]{2}-)?([A-Z0-9]{6})(?:-[SPTG])?$/i;
const BANK_HEADERS = new Set([
  "HDFCBK", "HDFCBN", "ICICIB", "ICICIT", "SBIUPI", "SBIINB", "SBIPSG", "CBSSBI", "ATMSBI", "SBICRD", "AXISBK", "AXISBN",
  "KOTAKB", "PNBSMS", "BOBTXN", "BOBSMS", "CANBNK", "UNIONB", "IDFCFB", "INDUSB", "YESBNK", "IDBIBK", "FEDBNK", "AUBANK",
  "RBLBNK", "CITIBK", "HSBCIN", "PAYTMB", "AIRBNK", "SCBANK", "IOBCHN", "BOIIND", "CENTBK", "UCOBNK", "KVBANK", "DBSBNK",
]);
/** A header missing from the list still counts when it reads like a bank's. */
const BANKISH = /(?:BNK|BANK|BK)$|^BANK/;

/** Only bank senders are trusted, so a forwarded or fake "bank" text from a phone number is never imported. */
export function isBankSender(from: string): boolean {
  const m = from.trim().match(DLT);
  if (!m) return false;
  const header = m[1].toUpperCase();
  if (/^\d+$/.test(header)) return false;
  return BANK_HEADERS.has(header) || BANKISH.test(header);
}

const REF = /(?:\bref(?:erence)?\s*(?:no\.?|number)?|\butr|\brrn|\bupi(?:\s*ref)?)\s*[:#.-]?\s*(\d{9,18})\b/i;

/** The bank or UPI reference number, when the message has one. */
export function refOf(text: string): string | undefined {
  return text.match(REF)?.[1];
}

export interface TxFingerprint { type: string; amount: number; at: number; ref?: string }
export const SAME_TX_WINDOW_MS = 15 * 60_000;

/**
 * One payment often arrives twice (bank SMS and UPI app alert). References decide when both sides have one;
 * otherwise the same amount and type within 15 minutes counts as the same payment.
 */
export function isSameTx(a: TxFingerprint, b: TxFingerprint): boolean {
  if (a.type !== b.type || a.amount !== b.amount) return false;
  if (a.ref && b.ref) return a.ref === b.ref;
  return Math.abs(a.at - b.at) < SAME_TX_WINDOW_MS;
}
