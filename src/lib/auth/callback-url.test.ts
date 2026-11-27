import { describe, expect, it } from "vitest";
import { codeFromCallbackUrl } from "./callback-url";

describe("codeFromCallbackUrl", () => {
  it("reads the PKCE code from the app's deep link", () => {
    expect(codeFromCallbackUrl("com.extrack.app://auth/callback?code=abc123")).toBe("abc123");
  });
  it("ignores other links", () => {
    expect(codeFromCallbackUrl("https://example.com/auth/callback?code=abc")).toBeNull();
    expect(codeFromCallbackUrl("com.extrack.app://auth/callback?error=access_denied")).toBeNull();
  });
});
