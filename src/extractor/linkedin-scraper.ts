import { chromium, errors as playwrightErrors, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import type { Config } from "../config.js";
import { AppError, isAppError } from "../domain/errors.js";
import { isLinkedInHost } from "../lib/linkedin-url.js";
import { Semaphore } from "../lib/semaphore.js";
import { expandVisibleSections, extractDomSnapshot } from "./dom.js";
import { mapExtraction } from "./mapper.js";
import type { ProfileScraper, RawExtraction, ScrapeOutput } from "./types.js";

const DETAIL_SECTIONS = ["experience", "education", "skills", "certifications", "languages"] as const;
const MAX_CAPTURE_BYTES = 2_000_000;
const MAX_TOTAL_CAPTURE_BYTES = 8_000_000;
const MAX_PAYLOADS = 10;

export class LinkedInScraper implements ProfileScraper {
  private browserPromise: Promise<Browser> | undefined;
  private readonly semaphore: Semaphore;

  public constructor(private readonly config: Config) {
    this.semaphore = new Semaphore(config.scrapeConcurrency, config.scrapeQueueMax);
  }

  public async scrape(profileUrl: string): Promise<ScrapeOutput> {
    const deadline = Date.now() + this.config.scrapeTimeoutMs;
    const release = await this.semaphore.acquire(Math.min(remainingMs(deadline), 10_000));
    try {
      assertTimeRemaining(deadline);
      return await this.scrapeWithRetries(profileUrl, deadline);
    } finally {
      release();
    }
  }

  public async checkReady(): Promise<void> {
    const deadline = Date.now() + Math.min(this.config.scrapeTimeoutMs, 10_000);
    const browser = await this.getBrowser(deadline);
    let context: BrowserContext | undefined;
    try {
      context = await withDeadline(this.createContext(browser), deadline);
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  public async close(): Promise<void> {
    const browser = await this.browserPromise;
    this.browserPromise = undefined;
    await browser?.close();
  }

  private async scrapeWithRetries(profileUrl: string, deadline: number): Promise<ScrapeOutput> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      try {
        assertTimeRemaining(deadline);
        return await this.scrapeOnce(profileUrl, deadline);
      } catch (error) {
        lastError = error;
        const retryable =
          isAppError(error) &&
          error.retryable &&
          !["LINKEDIN_BLOCKED", "SCRAPE_CAPACITY_EXCEEDED", "SCRAPE_TIMEOUT"].includes(error.code);
        if (!retryable || attempt === this.config.maxRetries || remainingMs(deadline) <= 0) throw error;
        await delay(Math.min(250 * 2 ** attempt, remainingMs(deadline)));
      }
    }
    throw lastError;
  }

  private async scrapeOnce(profileUrl: string, deadline: number): Promise<ScrapeOutput> {
    let context: BrowserContext | undefined;
    const timeoutState = { expired: false };
    const timeout = setTimeout(() => {
      timeoutState.expired = true;
      void context?.close();
    }, remainingMs(deadline));

    try {
      const browser = await this.getBrowser(deadline);
      assertTimeRemaining(deadline);
      context = await this.createContext(browser);
      assertTimeRemaining(deadline);
      const collector = new VoyagerCollector();
      const page = await context.newPage();
      page.setDefaultNavigationTimeout(boundedTimeout(deadline, this.config.navigationTimeoutMs));
      page.on("response", (response) => collector.capture(response));

      await this.navigate(page, profileUrl, true, deadline);
      await expandVisibleSections(page);
      const base = await extractDomSnapshot(page);
      const details: RawExtraction["details"] = {};
      const warnings: string[] = [];

      for (const section of DETAIL_SECTIONS) {
        const detailUrl = `${profileUrl}details/${section}/`;
        try {
          await this.navigate(page, detailUrl, false, deadline);
          if (!samePath(page.url(), detailUrl)) {
            throw new AppError("PROFILE_NOT_FOUND", `${section} detail view was not returned`, 404);
          }
          await expandVisibleSections(page);
          const snapshot = await extractDomSnapshot(page);
          if (snapshot.mainCards.length === 0) {
            warnings.push(`${section} detail page contained no recognized profile cards; base-page data was used`);
          } else {
            details[section] = snapshot;
          }
        } catch (error) {
          if (isAppError(error) && ["LINKEDIN_AUTH_REQUIRED", "PROFILE_NOT_FOUND"].includes(error.code)) {
            warnings.push(`${section} detail page was unavailable; base-page data was used`);
            continue;
          }
          throw error;
        }
      }

      const voyagerPayloads = await collector.drain();
      return mapExtraction({
        profileUrl,
        authenticated: this.config.linkedInLiAt !== undefined,
        base,
        details,
        voyagerPayloads,
        warnings
      });
    } catch (error) {
      if (timeoutState.expired) {
        throw new AppError("SCRAPE_TIMEOUT", "LinkedIn extraction exceeded its time limit", 504, true, { cause: error });
      }
      if (error instanceof playwrightErrors.TimeoutError) {
        throw new AppError("UPSTREAM_ERROR", "LinkedIn did not respond before the navigation deadline", 502, true, {
          cause: error
        });
      }
      if (isAppError(error)) throw error;
      throw new AppError("UPSTREAM_ERROR", "LinkedIn extraction failed", 502, true, { cause: error });
    } finally {
      clearTimeout(timeout);
      await context?.close().catch(() => undefined);
    }
  }

  private async getBrowser(deadline?: number): Promise<Browser> {
    this.browserPromise ??= chromium
      .launch({
        headless: this.config.browserHeadless,
        args: ["--disable-dev-shm-usage"],
        ...(this.config.browserExecutablePath ? { executablePath: this.config.browserExecutablePath } : {})
      })
      .then((browser) => {
        browser.once("disconnected", () => {
          this.browserPromise = undefined;
        });
        return browser;
      });
    try {
      const browser = deadline === undefined ? await this.browserPromise : await withDeadline(this.browserPromise, deadline);
      if (!browser.isConnected()) {
        this.browserPromise = undefined;
        return await this.getBrowser(deadline);
      }
      return browser;
    } catch (error) {
      if (isAppError(error)) throw error;
      this.browserPromise = undefined;
      throw new AppError("UPSTREAM_ERROR", "Browser startup failed", 503, true, { cause: error });
    }
  }

  private async createContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      locale: "en-US",
      extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
      serviceWorkers: "block"
    });
    if (this.config.linkedInLiAt) {
      await context.addCookies([
        {
          name: "li_at",
          value: this.config.linkedInLiAt,
          domain: ".linkedin.com",
          path: "/",
          httpOnly: true,
          secure: true,
          sameSite: "None"
        }
      ]);
    }
    await context.route("**/*", (route) => {
      const requestUrl = route.request().url();
      if (!isAllowedBrowserRequest(requestUrl) || /\.(?:woff2?|ttf|mp4|webm)(?:\?.*)?$/i.test(requestUrl)) {
        return route.abort();
      }
      return route.continue();
    });
    return context;
  }

  private async navigate(page: Page, url: string, primary: boolean, deadline: number): Promise<void> {
    assertTimeRemaining(deadline);
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: boundedTimeout(deadline, this.config.navigationTimeoutMs)
    });
    const status = response?.status();
    if (status === 404) throw new AppError("PROFILE_NOT_FOUND", "LinkedIn profile was not found", 404);
    if (status === 429 || status === 999) {
      throw new AppError("LINKEDIN_BLOCKED", "LinkedIn temporarily rejected the browser session", 503, true);
    }
    if (status !== undefined && status >= 500) {
      throw new AppError("UPSTREAM_ERROR", `LinkedIn returned HTTP ${status}`, 502, true);
    }

    const finalUrl = new URL(page.url());
    const path = finalUrl.pathname.toLocaleLowerCase();
    if (!isLinkedInHost(finalUrl.hostname)) {
      throw new AppError("UPSTREAM_ERROR", "LinkedIn redirected the browser outside its allowed origin", 502);
    }
    if (path.includes("/checkpoint/")) {
      throw new AppError("LINKEDIN_SESSION_EXPIRED", "LinkedIn requires verification for the configured session", 503);
    }
    if (path.includes("/login") || path.includes("/authwall")) {
      const code = this.config.linkedInLiAt ? "LINKEDIN_SESSION_EXPIRED" : "LINKEDIN_AUTH_REQUIRED";
      const message = this.config.linkedInLiAt
        ? "The configured LinkedIn session is no longer accepted"
        : "LinkedIn requires an authenticated session for this profile";
      throw new AppError(code, message, 503);
    }

    await page
      .locator("main")
      .waitFor({
        state: "visible",
        timeout: boundedTimeout(deadline, Math.min(5_000, this.config.navigationTimeoutMs))
      })
      .catch(() => undefined);

    if (primary) {
      const bodyText = (await page.locator("body").innerText({ timeout: 3_000 })).slice(0, 5_000);
      if (/this page (?:doesn't|does not) exist|profile not found/i.test(bodyText)) {
        throw new AppError("PROFILE_NOT_FOUND", "LinkedIn profile was not found", 404);
      }
    }
  }
}

export function samePath(actual: string, expected: string): boolean {
  const normalizePath = (value: string) => new URL(value).pathname.replace(/\/+$/, "").toLocaleLowerCase();
  return normalizePath(actual) === normalizePath(expected);
}

export function isAllowedBrowserRequest(value: string): boolean {
  try {
    const url = new URL(value);
    if (["about:", "blob:", "data:"].includes(url.protocol)) return true;
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLocaleLowerCase();
    return (
      hostname === "linkedin.com" ||
      hostname.endsWith(".linkedin.com") ||
      hostname === "licdn.com" ||
      hostname.endsWith(".licdn.com")
    );
  } catch {
    return false;
  }
}

function remainingMs(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

function boundedTimeout(deadline: number, cap: number): number {
  return Math.max(1, Math.min(cap, remainingMs(deadline)));
}

function assertTimeRemaining(deadline: number): void {
  if (remainingMs(deadline) === 0) {
    throw new AppError("SCRAPE_TIMEOUT", "LinkedIn extraction exceeded its time limit", 504, true);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withDeadline<T>(operation: Promise<T>, deadline: number): Promise<T> {
  const milliseconds = remainingMs(deadline);
  if (milliseconds === 0) {
    throw new AppError("SCRAPE_TIMEOUT", "LinkedIn extraction exceeded its time limit", 504, true);
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new AppError("SCRAPE_TIMEOUT", "LinkedIn extraction exceeded its time limit", 504, true)),
          milliseconds
        );
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export class VoyagerCollector {
  private readonly payloads: unknown[] = [];
  private readonly pending = new Set<Promise<void>>();
  private acceptedResponses = 0;
  private capturedBytes = 0;

  public capture(response: Response): void {
    if (this.acceptedResponses >= MAX_PAYLOADS) return;
    let url: URL;
    try {
      url = new URL(response.url());
    } catch {
      return;
    }
    const headers = response.headers();
    const length = Number(headers["content-length"] ?? "0");
    if (
      !isLinkedInHost(url.hostname) ||
      !/^\/voyager\/api\/(?:graphql|identity\/)/.test(url.pathname) ||
      !response.ok() ||
      !headers["content-type"]?.includes("json") ||
      (length > 0 && length > MAX_CAPTURE_BYTES)
    ) {
      return;
    }
    this.acceptedResponses += 1;
    const task = response
      .body()
      .then((body) => {
        if (
          body.byteLength > MAX_CAPTURE_BYTES ||
          this.capturedBytes + body.byteLength > MAX_TOTAL_CAPTURE_BYTES ||
          this.payloads.length >= MAX_PAYLOADS
        ) {
          return;
        }
        this.capturedBytes += body.byteLength;
        this.payloads.push(JSON.parse(body.toString("utf8")) as unknown);
      })
      .catch(() => undefined)
      .finally(() => this.pending.delete(task));
    this.pending.add(task);
  }

  public async drain(): Promise<unknown[]> {
    for (let pass = 0; pass < 3; pass += 1) {
      await Promise.allSettled([...this.pending]);
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.pending.size === 0) break;
    }
    return this.payloads;
  }
}
