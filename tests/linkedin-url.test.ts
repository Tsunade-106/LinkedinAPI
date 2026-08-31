import { describe, expect, it } from "vitest";
import { AppError } from "../src/domain/errors.js";
import { normalizeLinkedInProfileUrl } from "../src/lib/linkedin-url.js";

describe("normalizeLinkedInProfileUrl", () => {
  it("canonicalizes valid LinkedIn profile URLs", () => {
    expect(normalizeLinkedInProfileUrl("https://in.linkedin.com/in/jane-doe?trk=public_profile")).toBe(
      "https://www.linkedin.com/in/jane-doe/"
    );
    expect(normalizeLinkedInProfileUrl("https://www.linkedin.com/in/jane-doe/")).toBe(
      "https://www.linkedin.com/in/jane-doe/"
    );
  });

  it.each([
    "http://www.linkedin.com/in/jane-doe",
    "https://linkedin.example/in/jane-doe",
    "https://www.linkedin.com/company/linkedin",
    "https://evil@www.linkedin.com/in/jane-doe",
    "https://www.linkedin.com:8443/in/jane-doe",
    "not a url"
  ])("rejects unsafe or unsupported URL %s", (value) => {
    expect(() => normalizeLinkedInProfileUrl(value)).toThrowError(AppError);
  });
});
