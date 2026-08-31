import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { loadConfig } from "../src/config.js";
import { extractDomSnapshot } from "../src/extractor/dom.js";
import { LinkedInScraper } from "../src/extractor/linkedin-scraper.js";

const browserDescribe = process.env.RUN_BROWSER_TESTS === "true" ? describe : describe.skip;

browserDescribe("DOM extractor browser integration", () => {
  let browser: Browser | undefined;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.BROWSER_EXECUTABLE_PATH
        ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
        : {})
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it("extracts identity, structured data, and only the expected detail section", async () => {
    const html = `
      <main>
        <h1>Jane Doe</h1>
        <div class="text-body-medium break-words">Staff Engineer</div>
        <nav><ul><li>Unrelated navigation item</li></ul></nav>
        <section>
          <h2>Experience</h2>
          <ul><li>Staff Engineer<br>Example Corp · Full-time<br>2022 - Present</li></ul>
        </section>
        <section><h2>People also viewed</h2><ul><li>Unrelated Person</li></ul></section>
        <script type="application/ld+json">{"@type":"Person","name":"Jane Doe"}</script>
      </main>
    `;
    await page.route("https://www.linkedin.com/**", (route) =>
      route.fulfill({ headers: { "content-type": "text/html; charset=utf-8" }, body: html })
    );
    await page.goto("https://www.linkedin.com/in/jane-doe/details/experience/");

    const snapshot = await extractDomSnapshot(page);
    expect(snapshot.name).toBe("Jane Doe");
    expect(snapshot.headline).toBe("Staff Engineer");
    expect(snapshot.jsonLd).toEqual([{ "@type": "Person", name: "Jane Doe" }]);
    expect(snapshot.mainCards).toEqual([["Staff Engineer", "Example Corp · Full-time", "2022 - Present"]]);
  });

  it("passes the production scraper readiness boundary", async () => {
    const scraper = new LinkedInScraper(
      loadConfig({
        NODE_ENV: "test",
        API_KEYS: "test-key",
        SCRAPE_TIMEOUT_MS: "10000",
        ...(process.env.BROWSER_EXECUTABLE_PATH
          ? { BROWSER_EXECUTABLE_PATH: process.env.BROWSER_EXECUTABLE_PATH }
          : {})
      })
    );
    try {
      await expect(scraper.checkReady()).resolves.toBeUndefined();
    } finally {
      await scraper.close();
    }
  });
});
