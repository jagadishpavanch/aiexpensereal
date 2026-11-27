import type { Category, MerchantRule, TxType } from "./types";

/**
 * On-device, explainable transaction categorization. Pure: no storage, no network.
 *
 * Precedence: (1) the user's own rules, (2) a built-in dictionary of Indian
 * brands, (3) word-boundary keywords, (4) a fallback. Every level only ever
 * returns a category that exists in `categories` with the right kind.
 */

export type CategorizeSource = "rule" | "merchant" | "keyword" | "fallback";

export interface CategorizeInput {
  merchant: string;
  /** Extra free text, e.g. the SMS body. Only keywords read it, never brands. */
  text?: string;
  type: TxType;
}

export interface CategorizeResult {
  categoryId: string;
  source: CategorizeSource;
  /** The rule, brand or keyword that decided it. Absent for the fallback. */
  matched?: string;
}

// ---------- normalization ----------

/** Legal or payment-processor names that should read as the brand people know. */
const LEGAL_NAMES: [RegExp, string][] = [
  [/\bbundl technologies\b/g, "swiggy"],
  [/\bzomato(?: media| online)?\b/g, "zomato"],
  [/\beternal (?:ltd|limited)\b/g, "zomato"],
  [/\bani technologies\b/g, "ola"],
  [/\bolacabs\b/g, "ola"],
  [/\buber (?:india systems|india|technologies|systems)\b/g, "uber"],
  [/\b(?:grofers(?: india)?|blink commerce)\b/g, "blinkit"],
  [/\bkiranakart(?: technologies)?\b/g, "zepto"],
  [/\b(?:supermarket grocery supplies|innovative retail concepts)\b/g, "bigbasket"],
  [/\bavenue supermarts\b/g, "dmart"],
  [/\bone97(?: communications)?\b/g, "paytm"],
  [/\bphone pe\b/g, "phonepe"],
  [/\bfsn e commerce(?: ventures)?\b/g, "nykaa"],
  [/\bjubilant foodworks\b/g, "dominos"],
  [/\bair india\b/g, "airindia"],
];

/** Words that carry no merchant identity. */
const NOISE = new Set(["upi", "vpa", "pos", "ecom", "ref", "utr", "txn", "imps", "neft", "rtgs", "p2m", "p2a"]);
const LEGAL_SUFFIX = new Set(["pvt", "ltd", "private", "limited", "llp", "india", "inc", "plc"]);

/** Lowercase, accent-free, apostrophes dropped, everything else non-alphanumeric turned into spaces. */
function plain(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Boils a raw merchant string (UPI VPA, SMS fragment, legal name) down to a
 * stable lowercase key: `"Bundl Technologies Pvt Ltd"` and `"SWIGGY@icici"`
 * both become `"swiggy"`. May return an empty string.
 */
export function normalizeMerchant(raw: string): string {
  // Drop the VPA handle (@okaxis, @ybl, ...) but keep the name before it.
  let s = plain(String(raw ?? "").replace(/@[a-z0-9.-]+/gi, " "));
  for (const [re, brand] of LEGAL_NAMES) s = s.replace(re, brand);
  const tokens = s.split(" ").filter((t) => {
    if (!t) return false;
    if (NOISE.has(t) || LEGAL_SUFFIX.has(t)) return false;
    if (/^\d{4,}$/.test(t) || /\d{5,}/.test(t)) return false; // reference numbers and long digit runs
    return true;
  });
  return tokens.join(" ");
}

// ---------- brand dictionary ----------

/** Brands that are normal words on their own: they only count as the *whole* merchant name. */
const EXACT_ONLY = new Set(["more", "vi", "metro", "shell", "rent", "gas", "dhan", "coin"]);

const BRANDS: Record<string, string[]> = {
  food: [
    "swiggy", "zomato", "dominos", "mcdonalds", "mcdonald", "kfc", "starbucks", "chai point", "chaayos", "burger king", "pizza hut", "subway", "haldirams",
    "barbeque nation", "faasos", "behrouz", "box8", "eatsure", "eatfit", "third wave coffee", "blue tokai", "cafe coffee day", "ccd", "theobroma",
    "baskin robbins", "wow momo", "biryani by kilo", "rebel foods", "dineout", "swiggy dineout", "magicpin food",
  ],
  groceries: [
    "bigbasket", "big basket", "blinkit", "zepto", "instamart", "swiggy instamart", "dmart", "d mart", "jiomart", "jio mart", "more", "more retail", "more supermarket",
    "reliance fresh", "reliance smart", "spencers", "spencer", "dunzo", "natures basket", "licious", "freshtohome", "country delight", "milkbasket", "ratnadeep", "star bazaar", "easyday",
  ],
  transport: [
    "uber", "ola", "olacabs", "rapido", "irctc", "redbus", "abhibus", "metro", "delhi metro", "namma metro", "bmrc", "dmrc", "fastag", "hpcl", "iocl", "bpcl",
    "indian oil", "indianoil", "bharat petroleum", "hindustan petroleum", "shell", "shell petrol", "nayara", "makemytrip", "goibibo", "cleartrip", "easemytrip", "ease my trip", "indigo airlines",
    "interglobe aviation", "airindia", "vistara", "akasa air", "yulu", "blusmart", "meru cabs", "namma yatri", "nammayatri", "zoomcar",
  ],
  bills: [
    "airtel", "jio", "vi", "vodafone", "vodafone idea", "bsnl", "bescom", "tneb", "tangedco", "msedcl", "tata power", "adani electricity", "bses", "torrent power",
    "act fibernet", "hathway", "tata play", "tatasky", "dish tv", "d2h", "jio fiber", "jiofiber", "mahanagar gas", "indraprastha gas", "igl", "mgl", "adani gas", "adanigas", "tatapower", "cesc", "gas", "lic",
  ],
  rent: ["nobroker", "nestaway", "rent"],
  shopping: [
    "amazon", "flipkart", "myntra", "ajio", "meesho", "nykaa", "croma", "reliance digital", "tata cliq", "tatacliq", "shopsy", "snapdeal", "decathlon", "ikea", "firstcry",
    "pepperfry", "urban ladder", "westside", "pantaloons", "zudio", "max fashion", "shoppers stop", "vijay sales",
  ],
  entertainment: [
    "netflix", "spotify", "hotstar", "disney hotstar", "prime video", "amazon prime", "amazonprime", "bookmyshow", "pvr", "inox", "pvr inox", "cinepolis", "youtube premium", "youtube", "sonyliv", "sony liv",
    "zee5", "jiocinema", "jio cinema", "jiohotstar", "jio hotstar", "gaana", "wynk", "audible", "playstation", "xbox", "steam games",
  ],
  health: [
    "apollo", "1mg", "tata 1mg", "pharmeasy", "netmeds", "practo", "medplus", "cult fit", "cultfit", "healthkart", "fortis", "max healthcare", "manipal",
    "lal path labs", "lal pathlabs", "thyrocare", "metropolis", "pathkind", "lenskart",
  ],
  freelance: ["upwork", "fiverr", "toptal", "payoneer", "freelancer"],
  // Wallets and payment apps name the app that moved the money, not what was bought, so no default category has this id either.
  wallets: ["phonepe", "paytm", "gpay", "google pay", "amazon pay", "mobikwik", "freecharge", "bharatpe", "cred"],
  // Brokers and fund houses: buying units moves wealth, it is not spending. No default category has this id, so categorize()
  // skips these; they exist for isKnownBrand(), which keeps a broker from being read as a person's name.
  investment: [
    "zerodha", "groww", "upstox", "kuvera", "angel one", "angelone", "paytm money", "paytmmoney", "hdfc securities", "hdfc sec", "hdfcsec", "motilal oswal", "motilal",
    "icici direct", "icicidirect", "5paisa", "dhan", "sharekhan", "smallcase", "indmoney", "coin",
  ],
};

interface Brand { alias: string; categoryId: string }

/** Whether a payee name is a known brand or business ("Swiggy", "irctc"), as opposed to a person. Ignores whether the user has the matching category. */
export function isKnownBrand(name: string): boolean {
  const norm = normalizeMerchant(name);
  return norm !== "" && BRAND_LIST.some((b) => (EXACT_ONLY.has(b.alias) ? norm === b.alias : hasPhrase(norm, b.alias)));
}

// Longest alias first, so "swiggy instamart" beats "swiggy".
const BRAND_LIST: Brand[] = Object.entries(BRANDS)
  .flatMap(([categoryId, aliases]) => aliases.map((a) => ({ alias: plain(a), categoryId })))
  .sort((a, b) => b.alias.length - a.alias.length);

// ---------- keywords ----------

const KEYWORDS: Record<string, string[]> = {
  food: [
    "restaurant", "restro", "cafe", "dhaba", "biryani", "pizza", "burger", "bakery", "canteen", "mess", "kitchen", "tiffin", "meals", "eatery", "juice", "sweets",
    "chai", "coffee", "tea", "momos", "food", "dining", "lunch", "dinner", "breakfast", "snacks",
  ],
  groceries: ["grocery", "groceries", "supermarket", "kirana", "provision store", "vegetables", "fruits", "dairy", "milk", "mart"],
  transport: ["petrol", "diesel", "fuel", "cng", "parking", "toll", "cab", "taxi", "railway", "train ticket", "bus", "flight"],
  bills: ["electricity", "broadband", "recharge", "dth", "water bill", "lpg", "postpaid", "prepaid", "wifi", "insurance", "bbps", "utility", "emi"],
  rent: ["rent"],
  shopping: ["fashion", "apparel", "clothing", "electronics", "footwear", "garments", "boutique", "mall"],
  entertainment: ["movie", "movies", "cinema", "multiplex", "concert", "ott", "streaming"],
  health: ["pharmacy", "pharma", "medical", "medicals", "clinic", "hospital", "doctor", "dental", "dentist", "diagnostic", "diagnostics", "pathology", "chemist", "medicine", "medicines", "healthcare", "gym"],
  salary: ["salary", "sal cr", "payroll", "stipend"],
  freelance: ["invoice", "freelance"],
};

/** A keyword that must not be followed by one of these (e.g. "rent a car" is not rent). */
const KEYWORD_NOT: Record<string, string> = { rent: "rent a" };

interface Keyword { word: string; categoryId: string }
const KEYWORD_LIST: Keyword[] = Object.entries(KEYWORDS).flatMap(([categoryId, ws]) => ws.map((w) => ({ word: w, categoryId })));

// ---------- matching ----------

const hasPhrase = (hay: string, phrase: string) => ` ${hay} `.includes(` ${phrase} `);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Short rules match whole words ("ola" must not hit "cola"); longer ones may sit inside a word ("amazon" hits "amazonpay"). */
function ruleHits(needle: string, hay: string): boolean {
  if (!needle) return false;
  if (needle.length >= 5) return hay.includes(needle);
  return new RegExp(`(?:^|[^a-z0-9])${escapeRe(needle)}(?:[^a-z0-9]|$)`).test(hay);
}

function keywordHit(hay: string, kinds: Set<string>, ok: (id: string) => boolean): Keyword | undefined {
  let best: Keyword | undefined;
  for (const k of KEYWORD_LIST) {
    if (!kinds.has(k.categoryId) || !ok(k.categoryId)) continue;
    if (!hasPhrase(hay, k.word)) continue;
    const not = KEYWORD_NOT[k.word];
    if (not && hasPhrase(hay, not)) continue;
    if (!best || k.word.length > best.word.length) best = k;
  }
  return best;
}

/**
 * Picks a category for one transaction. See the file header for the order of
 * precedence. Never mutates its arguments.
 */
export function categorize(input: CategorizeInput, rules: MerchantRule[], categories: Category[]): CategorizeResult {
  const kind: Category["kind"] = input.type === "income" ? "income" : "expense";
  const valid = new Set(categories.filter((c) => c.kind === kind).map((c) => c.id));
  const ok = (id: string) => valid.has(id);

  const raw = String(input.merchant ?? "").toLowerCase();
  const norm = normalizeMerchant(input.merchant ?? "");

  // 1. The user's rules. Longest match wins.
  let bestRule: MerchantRule | undefined;
  let bestLen = 0;
  for (const r of rules) {
    const m = r.match.trim().toLowerCase();
    if (!m || !ok(r.categoryId) || m.length <= bestLen) continue;
    if (ruleHits(m, raw) || ruleHits(normalizeMerchant(m), norm)) {
      bestRule = r;
      bestLen = m.length;
    }
  }
  if (bestRule) return { categoryId: bestRule.categoryId, source: "rule", matched: bestRule.match.trim() };

  // 2. Known brands, read from the merchant only.
  if (norm) {
    for (const b of BRAND_LIST) {
      if (!ok(b.categoryId)) continue;
      const hit = EXACT_ONLY.has(b.alias) ? norm === b.alias : hasPhrase(norm, b.alias);
      if (hit) return { categoryId: b.categoryId, source: "merchant", matched: b.alias };
    }
  }

  // 3. Keywords: the merchant first, then the merchant plus the free text.
  const kinds = new Set(Object.keys(KEYWORDS));
  const inMerchant = keywordHit(plain(input.merchant ?? ""), kinds, ok);
  if (inMerchant) return { categoryId: inMerchant.categoryId, source: "keyword", matched: inMerchant.word };
  if (input.text) {
    const inText = keywordHit(plain(`${input.merchant ?? ""} ${input.text}`), kinds, ok);
    if (inText) return { categoryId: inText.categoryId, source: "keyword", matched: inText.word };
  }

  // 4. Fallback. Prefer a category of the right kind ("other" for spending). With none of that kind,
  //    use "other" if it exists, then the first category of any kind. With no categories at all
  //    nothing exists to point at, so the id "other" is returned as a placeholder.
  const ofKind = categories.filter((c) => c.kind === kind);
  //    Unknown income is "other-income" rather than the first income category, which is Salary.
  const fallback =
    ofKind.find((c) => c.id === (kind === "expense" ? "other" : "other-income")) ??
    ofKind[0] ??
    categories.find((c) => c.id === "other") ??
    categories[0];
  return { categoryId: fallback?.id ?? "other", source: "fallback" };
}

/**
 * Whether saving a transaction should teach the engine a merchant rule.
 * Only an explicit pick in the sheet counts, and only when it differs from what
 * the engine would have chosen (a new entry) or from what was saved (an edit).
 */
export function shouldLearn(args: { userPicked: boolean; chosen: string; enginePick?: string; original?: string }): boolean {
  if (!args.userPicked) return false;
  return args.chosen !== (args.original ?? args.enginePick);
}

/** A short human reason for an automatic pick, or undefined when there is nothing to say. */
export function explainCategorization(r: CategorizeResult): string | undefined {
  if (!r.matched) return undefined;
  if (r.source === "rule") return `your rule "${r.matched}"`;
  if (r.source === "merchant") return `known merchant "${r.matched}"`;
  if (r.source === "keyword") return `"${r.matched}" in the name`;
  return undefined;
}
