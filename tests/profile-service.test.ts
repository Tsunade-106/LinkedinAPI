import { describe, expect, it } from "vitest";
import type { ProfileScraper } from "../src/extractor/types.js";
import { ProfileService } from "../src/service/profile-service.js";

class DelayedScraper implements ProfileScraper {
  public calls = 0;
  public async scrape(profileUrl: string) {
    this.calls += 1;
    await Promise.resolve();
    return {
      profile: {
        profileUrl,
        name: "Jane Doe",
        experience: [],
        education: [],
        skills: [],
        certifications: [],
        languages: []
      },
      extractionMode: "public" as const,
      warnings: []
    };
  }
  public close(): Promise<void> {
    return Promise.resolve();
  }
  public checkReady(): Promise<void> {
    return Promise.resolve();
  }
}

describe("ProfileService", () => {
  it("coalesces concurrent work and caches completed results", async () => {
    const scraper = new DelayedScraper();
    const service = new ProfileService(scraper, { cacheMaxEntries: 10, cacheTtlSeconds: 60 });
    const url = "https://www.linkedin.com/in/jane-doe/";

    const [first, concurrent] = await Promise.all([service.getProfile(url), service.getProfile(url)]);
    const cached = await service.getProfile(url);

    expect(first.cache).toBe("miss");
    expect(concurrent.cache).toBe("miss");
    expect(cached.cache).toBe("hit");
    expect(scraper.calls).toBe(1);
  });

  it("disables completed-result caching when TTL is zero", async () => {
    const scraper = new DelayedScraper();
    const service = new ProfileService(scraper, { cacheMaxEntries: 10, cacheTtlSeconds: 0 });
    const url = "https://www.linkedin.com/in/jane-doe/";

    await service.getProfile(url);
    await service.getProfile(url);

    expect(scraper.calls).toBe(2);
  });
});
