import { describe, expect, it } from "vitest";
import { normalizeSms } from "./normalize";

describe("normalizeSms", () => {
  it("leaves an English message alone apart from spacing", () => {
    expect(normalizeSms("Rs.250.00  debited\tfrom A/c XX4821\nOn 21/10/26")).toBe("Rs.250.00 debited from A/c XX4821\nOn 21/10/26");
  });

  it("keeps the rupee sign", () => {
    expect(normalizeSms("You paid ₹ 180.00 to Cafe Coffee Day")).toBe("You paid ₹ 180.00 to Cafe Coffee Day");
  });

  it.each([
    ["Hindi", "HDFC: आपके खाते XX4248 से Rs.268.73 डेबिट हुआ। दिनांक 28-04-2025। संदर्भ: 430298465323", /A\/c XX4248.*Rs\.268\.73 debited.*Ref: 430298465323/],
    ["Bengali", "HDFC: আপনার অ্যাকাউন্ট XX3285 এ Rs.813.32 ক্রেডিট হয়েছে। তারিখ 15-03-2025। Ref: 128078357023", /A\/c XX3285.*Rs\.813\.32 credited/],
    ["Tamil", "HDFC: உங்கள் கணக்கு XX4637 இல் இருந்து Rs.52.01 டெபிட் செய்யப்பட்டது. தேதி 22-02-2025. Ref: 368297581461", /A\/c XX4637.*Rs\.52\.01 debited/],
    ["Telugu", "HDFC: మీ ఖాతా XX1246 కు Rs.132.91 క్రెడిట్ చేయబడింది. తేదీ 12-03-2025. Ref: 178291052121", /A\/c XX1246.*Rs\.132\.91 credited/],
    ["Kannada", "HDFC: ನಿಮ್ಮ ಖಾತೆ XX6046 ನಿಂದ Rs.303.99 ಡೆಬಿಟ್ ಆಗಿದೆ. ದಿನಾಂಕ 05-12-2025. Ref: 714503312307", /A\/c XX6046.*Rs\.303\.99 debited/],
  ])("translates the banking words in %s", (_lang, text, want) => {
    expect(normalizeSms(text)).toMatch(want);
  });

  it("turns native digits into ASCII digits", () => {
    expect(normalizeSms("ICICI: आपके खाते XX३९३१ से Rs.१,०५६.४५ डेबिट हुआ। दिनांक ११-०१-२०२६।")).toMatch(/XX3931.*Rs\.1,056\.45 debited.*11-01-2026/);
    expect(normalizeSms("HDFC: உங்கள் கணக்கு XX௨௧௯௩ இல் இருந்து Rs.௮,௫௩௭.௩௮ டெபிட் செய்யப்பட்டது.")).toMatch(/XX2193.*Rs\.8,537\.38 debited/);
  });

  it("writes an ISO date day-first so the due-date rule can read it", () => {
    expect(normalizeSms("Due date: 2025-09-26. Pay online")).toBe("Due date: 26-09-2025. Pay online");
  });

  it("drops zero-width characters and folds full-width forms", () => {
    expect(normalizeSms("Rs​.500 debited")).toBe("Rs.500 debited");
    expect(normalizeSms("ＲＳ.500 debited")).toBe("RS.500 debited");
  });

  it("does not touch Hindi words that merely contain a rupee abbreviation", () => {
    expect(normalizeSms("गुरुवार को मिलते हैं")).toBe("गुरुवार को मिलते हैं");
  });

  it("returns an empty string for nothing", () => {
    expect(normalizeSms("")).toBe("");
    expect(normalizeSms(undefined as unknown as string)).toBe("");
  });
});
