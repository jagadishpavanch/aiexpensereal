import { describe, expect, it } from "vitest";
import { projectUrl } from "./project-url";

describe("projectUrl", () => {
  it("keeps a plain project URL", () => {
    expect(projectUrl("https://abc.supabase.co")).toBe("https://abc.supabase.co");
  });

  // Supabase's dashboard also shows the REST endpoint; pasted into the env var, sign-in went to
  // /rest/v1/auth/v1/authorize and Supabase answered "No API key found in request".
  it("drops a pasted /rest/v1/ path, trailing slashes and spaces", () => {
    expect(projectUrl(" https://abc.supabase.co/rest/v1/ ")).toBe("https://abc.supabase.co");
    expect(projectUrl("https://abc.supabase.co/")).toBe("https://abc.supabase.co");
  });

  it("returns undefined for a missing or unparseable value", () => {
    expect(projectUrl(undefined)).toBeUndefined();
    expect(projectUrl("")).toBeUndefined();
    expect(projectUrl("not a url")).toBeUndefined();
  });
});
