import { AppError } from "../domain/errors.js";
import {
  profileSchema,
  type Certification,
  type DateRange,
  type Education,
  type Experience,
  type Language,
  type Profile
} from "../domain/profile.js";
import type { DomSection, DomSnapshot, RawExtraction, ScrapeOutput } from "./types.js";
import { extractVoyagerData } from "./voyager.js";

const DATE_LINE = /\b(?:present|19\d{2}|20\d{2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const NOISE = /^(?:show|see) (?:all|more)|^(?:logo|image)$|^skill endorsements?$|^endorse$/i;

export function mapExtraction(raw: RawExtraction): ScrapeOutput {
  const publicIdentifier = decodeURIComponent(new URL(raw.profileUrl).pathname.split("/").filter(Boolean).at(-1) ?? "");
  const voyager = extractVoyagerData(raw.voyagerPayloads, publicIdentifier);
  const linkedData = extractLinkedData(raw.base.jsonLd);
  const domExperience = parseExperiences(cardsFor(raw, "experience"));
  const domEducation = parseEducation(cardsFor(raw, "education"));
  const domSkills = parseSkills(cardsFor(raw, "skills"));
  const domCertifications = parseCertifications(cardsFor(raw, "certifications"));
  const domLanguages = parseLanguages(cardsFor(raw, "languages"));
  const aboutSection = findSection(raw.base, "about");

  const name = voyager.profile.name ?? linkedData.name ?? clean(raw.base.name);
  if (!name) {
    throw new AppError(
      "UPSTREAM_ERROR",
      "LinkedIn returned a page, but no profile identity could be extracted",
      502,
      true
    );
  }

  const profile = profileSchema.parse({
    profileUrl: raw.profileUrl,
    name,
    headline: voyager.profile.headline ?? linkedData.headline ?? clean(raw.base.headline),
    location: voyager.profile.location ?? linkedData.location ?? cleanLocation(raw.base.location),
    about: voyager.profile.about ?? linkedData.about ?? parseAbout(aboutSection),
    profileImageUrl: voyager.profile.profileImageUrl ?? linkedData.profileImageUrl ?? validUrl(raw.base.profileImageUrl),
    backgroundImageUrl: voyager.profile.backgroundImageUrl ?? validUrl(raw.base.backgroundImageUrl),
    experience: mergeUnique(voyager.experience, domExperience, experienceKey),
    education: mergeUnique(voyager.education, [...linkedData.education, ...domEducation], educationKey),
    skills: mergeUnique(voyager.skills, domSkills, (value) => value.toLocaleLowerCase()),
    certifications: mergeUnique(voyager.certifications, domCertifications, certificationKey),
    languages: mergeUnique(voyager.languages, domLanguages, (value) => value.name.toLocaleLowerCase())
  });

  const warnings = [...raw.warnings];
  for (const [field, missing] of [
    ["about", !profile.about],
    ["experience", profile.experience.length === 0],
    ["education", profile.education.length === 0],
    ["skills", profile.skills.length === 0],
    ["certifications", profile.certifications.length === 0],
    ["languages", profile.languages.length === 0]
  ] as const) {
    if (missing) warnings.push(`${field} was not available to this LinkedIn session`);
  }

  return {
    profile,
    extractionMode: raw.authenticated ? "authenticated" : "public",
    warnings: [...new Set(warnings)]
  };
}

export function calculateCompleteness(profile: Profile): number {
  const values = [
    profile.name,
    profile.headline,
    profile.location,
    profile.about,
    profile.profileImageUrl,
    profile.experience,
    profile.education,
    profile.skills,
    profile.certifications,
    profile.languages
  ];
  const present = values.filter((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value))).length;
  return Math.round((present / values.length) * 100);
}

function cardsFor(raw: RawExtraction, key: keyof RawExtraction["details"]): string[][] {
  const detail = raw.details[key];
  if (detail && detail.mainCards.length > 0) return detail.mainCards;
  return findSection(raw.base, key)?.cards ?? [];
}

function findSection(snapshot: DomSnapshot, name: string): DomSection | undefined {
  const wanted = name.replace(/s$/, "");
  return snapshot.sections.find((section) => section.heading.toLocaleLowerCase().includes(wanted));
}

function parseExperiences(cards: string[][]): Experience[] {
  return uniqueCards(cards).flatMap((rawLines) => {
    const lines = sanitizeLines(rawLines);
    const title = lines[0];
    if (!title) return [];
    const dateIndex = lines.findIndex((line) => DATE_LINE.test(line) && /[-–—]/.test(line));
    const companyLine = dateIndex > 1 ? lines[1] : undefined;
    const [company, employmentType] = splitDot(companyLine);
    const dateRange = dateIndex >= 0 ? parseDateRange(lines[dateIndex]) : undefined;
    const location = dateIndex >= 0 ? clean(lines[dateIndex + 1]?.split(" · ")[0]) : undefined;
    const descriptionLines = lines.slice(dateIndex >= 0 ? dateIndex + 2 : 2).filter((line) => !line.startsWith("Skills:"));
    const skillLine = lines.find((line) => /^skills?:/i.test(line));
    return [{
      title,
      ...(company ? { company } : {}),
      ...(employmentType ? { employmentType } : {}),
      ...(location ? { location } : {}),
      ...(dateRange ? { dateRange } : {}),
      ...(descriptionLines.length > 0 ? { description: descriptionLines.join("\n") } : {}),
      skills: skillLine ? skillLine.replace(/^skills?:\s*/i, "").split(",").map(clean).filter(isText) : []
    }];
  });
}

function parseEducation(cards: string[][]): Education[] {
  return uniqueCards(cards).flatMap((rawLines) => {
    const lines = sanitizeLines(rawLines);
    const school = lines[0];
    if (!school) return [];
    const dateIndex = lines.findIndex((line) => DATE_LINE.test(line) && /[-–—]/.test(line));
    const degreeLine = dateIndex > 1 ? lines[1] : undefined;
    const [degree, fieldOfStudy] = splitComma(degreeLine);
    const dateRange = dateIndex >= 0 ? parseDateRange(lines[dateIndex]) : undefined;
    const gradeLine = lines.find((line) => /^grade:/i.test(line));
    const activitiesLine = lines.find((line) => /^activities and societies:/i.test(line));
    const used = new Set([school, degreeLine, dateIndex >= 0 ? lines[dateIndex] : undefined, gradeLine, activitiesLine]);
    const description = lines.filter((line) => !used.has(line)).join("\n");
    return [{
      school,
      ...(degree ? { degree } : {}),
      ...(fieldOfStudy ? { fieldOfStudy } : {}),
      ...(dateRange ? { dateRange } : {}),
      ...(gradeLine ? { grade: gradeLine.replace(/^grade:\s*/i, "") } : {}),
      ...(activitiesLine ? { activities: activitiesLine.replace(/^activities and societies:\s*/i, "") } : {}),
      ...(description ? { description } : {})
    }];
  });
}

function parseSkills(cards: string[][]): string[] {
  return uniqueCards(cards)
    .map((lines) => sanitizeLines(lines)[0])
    .filter(isText)
    .filter((line) => !/endorsement|associated with|show all/i.test(line));
}

function parseCertifications(cards: string[][]): Certification[] {
  return uniqueCards(cards).flatMap((rawLines) => {
    const lines = sanitizeLines(rawLines);
    const name = lines[0];
    if (!name) return [];
    const issuingOrganization = lines[1];
    const issued = lines.find((line) => /^issued\s/i.test(line));
    const credential = lines.find((line) => /^credential id\s/i.test(line));
    const [issueDate, expirationDate] = issued
      ? issued.replace(/^issued\s*/i, "").split(/\s*·\s*expires\s*/i).map(clean)
      : [];
    return [{
      name,
      ...(issuingOrganization ? { issuingOrganization } : {}),
      ...(issueDate ? { issueDate } : {}),
      ...(expirationDate ? { expirationDate } : {}),
      ...(credential ? { credentialId: credential.replace(/^credential id\s*/i, "") } : {})
    }];
  });
}

function parseLanguages(cards: string[][]): Language[] {
  return uniqueCards(cards).flatMap((rawLines) => {
    const lines = sanitizeLines(rawLines);
    const name = lines[0];
    if (!name) return [];
    return [{ name, ...(lines[1] ? { proficiency: lines[1] } : {}) }];
  });
}

function parseAbout(section: DomSection | undefined): string | undefined {
  if (!section) return undefined;
  const heading = section.heading.toLocaleLowerCase();
  const lines = section.text.split(/\n+/).map(clean).filter(isText);
  const content = lines.filter((line) => line.toLocaleLowerCase() !== heading && !NOISE.test(line));
  return clean(content.join("\n"));
}

function parseDateRange(value: string | undefined): DateRange | undefined {
  if (!value) return undefined;
  const [range = "", duration] = value.split(" · ").map(clean);
  const [startDate, endDate] = range.split(/\s+[-–—]\s+/).map(clean);
  if (!startDate && !endDate) return undefined;
  return {
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(duration ? { duration } : {})
  };
}

function sanitizeLines(lines: string[]): string[] {
  return lines.map(clean).filter(isText).filter((line) => !NOISE.test(line));
}

function uniqueCards(cards: string[][]): string[][] {
  return mergeUnique([], cards, (lines) => lines.slice(0, 3).join("|").toLocaleLowerCase());
}

function splitDot(value: string | undefined): [string | undefined, string | undefined] {
  if (!value) return [undefined, undefined];
  const [first, second] = value.split(" · ").map(clean);
  return [first ?? undefined, second ?? undefined];
}

function splitComma(value: string | undefined): [string | undefined, string | undefined] {
  if (!value) return [undefined, undefined];
  const [first, ...rest] = value.split(",").map(clean);
  return [first ?? undefined, clean(rest.join(", "))];
}

function cleanLocation(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return clean(value.split("\n")[0]?.replace(/\s*Contact info.*$/i, ""));
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  return normalized?.length ? normalized : undefined;
}

function isText(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function validUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function mergeUnique<T>(primary: T[], secondary: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return [...primary, ...secondary].filter((value) => {
    const identifier = key(value);
    if (!identifier || seen.has(identifier)) return false;
    seen.add(identifier);
    return true;
  });
}

function experienceKey(value: Experience): string {
  return `${value.title}|${value.company ?? ""}|${value.dateRange?.startDate ?? ""}`.toLocaleLowerCase();
}

function educationKey(value: Education): string {
  return `${value.school}|${value.degree ?? ""}|${value.dateRange?.startDate ?? ""}`.toLocaleLowerCase();
}

function certificationKey(value: Certification): string {
  return `${value.name}|${value.issuingOrganization ?? ""}`.toLocaleLowerCase();
}

interface LinkedData {
  name?: string;
  headline?: string;
  location?: string;
  about?: string;
  profileImageUrl?: string;
  education: Education[];
}

function extractLinkedData(values: unknown[]): LinkedData {
  const objects = values.flatMap(flattenJsonLd);
  const person = objects.find((value) => {
    const type = value["@type"];
    return type === "Person" || (Array.isArray(type) && type.includes("Person"));
  });
  if (!person) return { education: [] };
  const locationObject = asObject(person.address);
  const alumni = Array.isArray(person.alumniOf) ? person.alumniOf : person.alumniOf ? [person.alumniOf] : [];
  const education = alumni.flatMap((entry): Education[] => {
    const object = asObject(entry);
    const school = textValue(object?.name);
    return school ? [{ school }] : [];
  });
  const image = typeof person.image === "string" ? person.image : textValue(asObject(person.image)?.url);
  const name = textValue(person.name);
  const headline = textValue(person.jobTitle);
  const location = textValue(locationObject?.addressLocality);
  const about = textValue(person.description);
  const profileImageUrl = validUrl(image);
  return {
    ...(name ? { name } : {}),
    ...(headline ? { headline } : {}),
    ...(location ? { location } : {}),
    ...(about ? { about } : {}),
    ...(profileImageUrl ? { profileImageUrl } : {}),
    education
  };
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const object = asObject(value);
  if (!object) return [];
  const graph = Array.isArray(object["@graph"]) ? object["@graph"].flatMap(flattenJsonLd) : [];
  return [object, ...graph];
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" ? clean(value) : undefined;
}
