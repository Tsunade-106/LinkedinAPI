import { LRUCache } from "lru-cache";
import type { Config } from "../config.js";
import type { ScrapeOutput, ProfileScraper } from "../extractor/types.js";

export interface ServiceResult {
  output: ScrapeOutput;
  cache: "hit" | "miss";
  fetchedAt: string;
}

interface CacheValue {
  output: ScrapeOutput;
  fetchedAt: string;
}

export class ProfileService {
  private readonly cache: LRUCache<string, CacheValue>;
  private readonly inFlight = new Map<string, Promise<CacheValue>>();
  private readonly cacheEnabled: boolean;
  private readonly cacheMaxValueBytes: number;

  public constructor(
    private readonly scraper: ProfileScraper,
    config: Pick<Config, "cacheMaxEntries" | "cacheTtlSeconds"> & { cacheMaxValueBytes?: number }
  ) {
    this.cacheEnabled = config.cacheTtlSeconds > 0;
    this.cacheMaxValueBytes = config.cacheMaxValueBytes ?? 524_288;
    this.cache = new LRUCache({
      max: config.cacheMaxEntries,
      ttl: config.cacheTtlSeconds * 1_000,
      ttlAutopurge: this.cacheEnabled
    });
  }

  public async getProfile(profileUrl: string, refresh = false): Promise<ServiceResult> {
    const cached = refresh || !this.cacheEnabled ? undefined : this.cache.get(profileUrl);
    if (cached) return { ...cached, cache: "hit" };

    let request = this.inFlight.get(profileUrl);
    if (!request) {
      request = this.fetchAndCache(profileUrl);
      this.inFlight.set(profileUrl, request);
      void request.finally(() => this.inFlight.delete(profileUrl)).catch(() => undefined);
    }
    const value = await request;
    return { ...value, cache: "miss" };
  }

  public async close(): Promise<void> {
    await this.scraper.close();
  }

  private async fetchAndCache(profileUrl: string): Promise<CacheValue> {
    const output = await this.scraper.scrape(profileUrl);
    const value = { output, fetchedAt: new Date().toISOString() };
    if (this.cacheEnabled && Buffer.byteLength(JSON.stringify(output), "utf8") <= this.cacheMaxValueBytes) {
      this.cache.set(profileUrl, value);
    }
    return value;
  }
}
