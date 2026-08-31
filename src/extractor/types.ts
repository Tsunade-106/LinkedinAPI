import type { Profile } from "../domain/profile.js";

export interface DomSection {
  heading: string;
  cards: string[][];
  text: string;
}

export interface DomSnapshot {
  pageUrl: string;
  name?: string;
  headline?: string;
  location?: string;
  profileImageUrl?: string;
  backgroundImageUrl?: string;
  jsonLd: unknown[];
  sections: DomSection[];
  mainCards: string[][];
}

export interface RawExtraction {
  profileUrl: string;
  authenticated: boolean;
  base: DomSnapshot;
  details: Partial<Record<"experience" | "education" | "skills" | "certifications" | "languages", DomSnapshot>>;
  voyagerPayloads: unknown[];
  warnings: string[];
}

export interface ScrapeOutput {
  profile: Profile;
  extractionMode: "authenticated" | "public";
  warnings: string[];
}

export interface ProfileScraper {
  scrape(profileUrl: string): Promise<ScrapeOutput>;
  checkReady(): Promise<void>;
  close(): Promise<void>;
}
