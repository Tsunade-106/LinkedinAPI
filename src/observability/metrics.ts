import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export class Metrics {
  public readonly registry = new Registry();
  public readonly scrapeDuration: Histogram;
  public readonly scrapeTotal: Counter;
  public readonly cacheTotal: Counter;
  public readonly serviceUp: Gauge;

  public constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: "linkedin_profile_api_" });
    this.scrapeDuration = new Histogram({
      name: "linkedin_profile_api_scrape_duration_seconds",
      help: "Time spent resolving a profile request",
      labelNames: ["outcome"],
      buckets: [0.1, 0.5, 1, 2.5, 5, 10, 20, 45, 90],
      registers: [this.registry]
    });
    this.scrapeTotal = new Counter({
      name: "linkedin_profile_api_scrape_total",
      help: "Profile resolution attempts",
      labelNames: ["outcome"],
      registers: [this.registry]
    });
    this.cacheTotal = new Counter({
      name: "linkedin_profile_api_cache_total",
      help: "Profile cache outcomes",
      labelNames: ["result"],
      registers: [this.registry]
    });
    this.serviceUp = new Gauge({
      name: "linkedin_profile_api_up",
      help: "Whether the API process considers itself ready",
      registers: [this.registry]
    });
    this.serviceUp.set(0);
  }
}
