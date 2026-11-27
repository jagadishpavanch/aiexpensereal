/**
 * Turns a bank message into the plain-English shape the reader understands. Pure: no storage, no network.
 *
 * Banks send alerts in Hindi, Bengali, Tamil, Telugu and Kannada as well as English. The amount ("Rs.27.47"),
 * the masked account ("XX7133") and the reference are already readable, so only the banking words need
 * translating. The word forms below are the ones seen in FinEE train/valid rows (HDFC, ICICI and SBI templates).
 */

/** Native digit blocks (Devanagari, Bengali, Tamil, Telugu, Kannada) to ASCII; NFKC leaves these alone. */
const DIGIT_BLOCKS: [number, number][] = [
  [0x0966, 0x096f], // Devanagari
  [0x09e6, 0x09ef], // Bengali
  [0x0be6, 0x0bef], // Tamil
  [0x0c66, 0x0c6f], // Telugu
  [0x0ce6, 0x0cef], // Kannada
];
const NATIVE_DIGIT = new RegExp(`[${DIGIT_BLOCKS.map(([a, b]) => `\\u${a.toString(16).padStart(4, "0")}-\\u${b.toString(16).padStart(4, "0")}`).join("")}]`, "g");

function asciiDigits(s: string): string {
  return s.replace(NATIVE_DIGIT, (ch) => {
    const code = ch.charCodeAt(0);
    const block = DIGIT_BLOCKS.find(([a, b]) => code >= a && code <= b)!;
    return String(code - block[0]);
  });
}

/**
 * Banking words per script, longest first. Indic text has no word boundaries to lean on (a suffix such as "ಆಗಿದೆ"
 * sticks to its verb), so each entry is matched as a plain substring.
 */
const WORDS: [RegExp, string][] = [
  // debited
  [/डेबिट(?:\s*हुआ)?|डेबिट्|ডেবিট(?:\s*হয়েছে)?|டெபிட்(?:\s*செய்யப்பட்டது)?|డెబిట్(?:\s*చేయబడింది)?|ಡೆಬಿಟ್(?:\s*ಆಗಿದೆ)?/g, " debited "],
  // credited
  [/क्रेडिट(?:\s*हुआ)?|ক্রেডিট(?:\s*হয়েছে)?|கிரெடிட்(?:\s*செய்யப்பட்டது)?|క్రెడిట్(?:\s*చేయబడింది)?|ಕ್ರೆಡಿಟ್(?:\s*ಆಗಿದೆ)?/g, " credited "],
  // account
  [/खाते|खाता|অ্যাকাউন্ট|অ্যাকাউন্টে|கணக்கு|ఖాతా|ಖಾತೆ/g, " A/c "],
  // reference and date labels
  [/संदर्भ|রেফারেন্স|குறிப்பு|సూచన|ಉಲ್ಲೇಖ/g, " Ref "],
  [/दिनांक|তারিখ|தேதி|తేదీ|ದಿನಾಂಕ/g, " on "],
  // rupee
  [/(?:रुपये|रु\.?|টাকা|ரூ\.?|రూ\.?|ರೂ\.?)(?=\s*\d)/g, " Rs. "],
];

/** Sentence end marks other than the Latin full stop (Devanagari danda and double danda). */
const DANDA = new RegExp("[\\u0964\\u0965]", "g");
/** Zero-width spaces, joiners and the byte order mark: invisible text that breaks word matching. */
const INVISIBLE = new RegExp("[\\u200b-\\u200d\\u2060\\ufeff]", "g");
/** Anything outside Latin, Latin Extended and general punctuation or currency signs (which holds the rupee sign). */
const NON_LATIN = new RegExp("[^\\u0000-\\u024f\\u2000-\\u20cf]");
/** Space, tab and no-break space. */
const SPACES = new RegExp("[ \\t\\u00a0]+", "g");
/** "2025-09-16" to "16-09-2025", the day-first form the reader's due-date rule expects. */
const ISO_DATE = /\b(20\d{2})-(\d{2})-(\d{2})(?![\d-])/g;

/**
 * NFKC, native digits to ASCII, banking words to English, dates day-first, one space between tokens.
 * Latin-only messages come back unchanged apart from collapsed spaces and ISO dates, so it is safe to call on every message.
 */
export function normalizeSms(text: string): string {
  let s = String(text ?? "").normalize("NFKC").replace(INVISIBLE, "").replace(ISO_DATE, "$3-$2-$1");
  if (!NON_LATIN.test(s)) return s.replace(SPACES, " ").trim();
  s = asciiDigits(s).replace(DANDA, ". ");
  for (const [re, en] of WORDS) s = s.replace(re, en);
  return s.replace(SPACES, " ").replace(/\s+([.:])/g, "$1").trim();
}
