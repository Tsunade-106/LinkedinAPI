import { describe, expect, it, vi } from "vitest";
import { chromium, type Browser, type BrowserContext, type Response, type Route } from "playwright";
import { loadConfig } from "../src/config.js";
import {
  LinkedInScraper,
  VoyagerCollector,
  isAllowedBrowserRequest,
  samePath
} from "../src/extractor/linkedin-scraper.js";

function response(overrides: {
  url?: string;
  ok?: boolean;
  contentType?: string;
  contentLength?: number;
  body?: string;
} = {}): Response {
  const body = Buffer.from(overrides.body ?? '{"included":[{"firstName":"Jane"}]}');
  return {
    url: () => overrides.url ?? "https://www.linkedin.com/voyager/api/identity/profiles/jane",
    ok: () => overrides.ok ?? true,
    headers: () => ({
      "content-type": overrides.contentType ?? "application/json; charset=utf-8",
      "content-length": String(overrides.contentLength ?? body.byteLength)
    }),
    body: () => Promise.resolve(body)
  } as unknown as Response;
}

describe("browser egress policy", () => {
  it.each([
    "https://www.linkedin.com/in/jane-doe/",
    "https://media.licdn.com/dms/image/example",
    "https://static-exp1.licdn.com/sc/h/example.js",
    "about:blank",
    "blob:https://www.linkedin.com/id",
    "data:text/plain,fixture"
  ])("allows %s", (url) => {
    expect(isAllowedBrowserRequest(url)).toBe(true);
  });

  it.each([
    "http://www.linkedin.com/in/jane-doe/",
    "https://linkedin.example/in/jane-doe/",
    "https://evillicdn.com/asset.js",
    "file:///etc/passwd",
    "not a url"
  ])("blocks %s", (url) => {
    expect(isAllowedBrowserRequest(url)).toBe(false);
  });

  it("compares normalized LinkedIn detail paths", () => {
    expect(
      samePath(
        "https://www.linkedin.com/in/jane-doe/details/experience/?trk=test",
        "https://www.linkedin.com/in/jane-doe/details/experience/"
      )
    ).toBe(true);
    expect(
      samePath(
        "https://www.linkedin.com/in/jane-doe/details/education/",
        "https://www.linkedin.com/in/jane-doe/details/experience/"
      )
    ).toBe(false);
  });
});

describe("LinkedInScraper browser lifecycle", () => {
  it("launches Chromium, validates a context, and applies the request allowlist", async () => {
    let routeHandler: ((route: Route) => Promise<void>) | undefined;
    const addCookies = vi.fn(() => Promise.resolve());
    const contextClose = vi.fn(() => Promise.resolve());
    const context = {
      addCookies,
      route: vi.fn((_pattern: string, handler: (route: Route) => Promise<void>) => {
        routeHandler = handler;
        return Promise.resolve();
      }),
      close: contextClose
    } as unknown as BrowserContext;
    const browserClose = vi.fn(() => Promise.resolve());
    const browser = {
      newContext: vi.fn(() => Promise.resolve(context)),
      isConnected: vi.fn(() => true),
      once: vi.fn(),
      close: browserClose
    } as unknown as Browser;
    const launch = vi.spyOn(chromium, "launch").mockResolvedValue(browser);
    const scraper = new LinkedInScraper(
      loadConfig({
        NODE_ENV: "test",
        API_KEYS: "test-key",
        LINKEDIN_LI_AT: "authorized-cookie-value",
        AUTHENTICATED_MODE_ENABLED: "true",
        SCRAPE_TIMEOUT_MS: "5000"
      })
    );

    await scraper.checkReady();
    expect(launch).toHaveBeenCalledWith({ headless: true, args: ["--disable-dev-shm-usage"] });
    expect(addCookies).toHaveBeenCalledOnce();
    expect(contextClose).toHaveBeenCalledOnce();

    const abort = vi.fn(() => Promise.resolve());
    const continueRequest = vi.fn(() => Promise.resolve());
    await routeHandler?.({
      request: () => ({ url: () => "https://media.licdn.com/font.woff2" }),
      abort,
      continue: continueRequest
    } as unknown as Route);
    expect(abort).toHaveBeenCalledOnce();

    await routeHandler?.({
      request: () => ({ url: () => "https://www.linkedin.com/voyager/api/graphql" }),
      abort,
      continue: continueRequest
    } as unknown as Route);
    expect(continueRequest).toHaveBeenCalledOnce();

    await scraper.close();
    expect(browserClose).toHaveBeenCalledOnce();
  });

  it("normalizes browser startup failures", async () => {
    vi.spyOn(chromium, "launch").mockRejectedValue(new Error("binary missing"));
    const scraper = new LinkedInScraper(
      loadConfig({ NODE_ENV: "test", API_KEYS: "test-key", SCRAPE_TIMEOUT_MS: "5000" })
    );

    await expect(scraper.checkReady()).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      statusCode: 503,
      retryable: true
    });
  });
});

describe("VoyagerCollector", () => {
  it("captures only bounded JSON payloads from expected LinkedIn endpoints", async () => {
    const collector = new VoyagerCollector();
    collector.capture(response());
    collector.capture(response({ url: "https://www.linkedin.com/voyager/api/graphql?queryId=example" }));
    collector.capture(response({ url: "https://example.com/voyager/api/identity/profile" }));
    collector.capture(response({ url: "https://www.linkedin.com/voyager/api/feed/updates" }));
    collector.capture(response({ ok: false }));
    collector.capture(response({ contentType: "text/html" }));
    collector.capture(response({ contentLength: 2_000_001 }));

    const payloads = await collector.drain();
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toMatchObject({ included: [{ firstName: "Jane" }] });
  });

  it("ignores malformed and oversized response bodies", async () => {
    const collector = new VoyagerCollector();
    collector.capture(response({ body: "not-json" }));
    collector.capture(response({ body: "x".repeat(2_000_001), contentLength: 0 }));

    await expect(collector.drain()).resolves.toEqual([]);
  });

  it("caps the number of accepted upstream responses", async () => {
    const collector = new VoyagerCollector();
    for (let index = 0; index < 20; index += 1) {
      collector.capture(response({ body: JSON.stringify({ index }) }));
    }

    await expect(collector.drain()).resolves.toHaveLength(10);
  });
});
