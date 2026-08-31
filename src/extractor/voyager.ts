import type {
  Certification,
  DateRange,
  Education,
  Experience,
  Language,
  Profile
} from "../domain/profile.js";

type JsonObject = Record<string, unknown>;

interface VoyagerData {
  profile: Partial<Profile>;
  experience: Experience[];
  education: Education[];
  skills: string[];
  certifications: Certification[];
  languages: Language[];
}

export function extractVoyagerData(payloads: unknown[], expectedPublicIdentifier: string): VoyagerData {
  const objects = payloads.flatMap((payload) => collectObjects(payload));
  const profileCandidate = objects.find(
    (object) =>
      getText(object, "firstName") !== undefined &&
      getText(object, "lastName") !== undefined &&
      getText(object, "publicIdentifier")?.toLocaleLowerCase() === expectedPublicIdentifier.toLocaleLowerCase()
  );

  const profile: Partial<Profile> = {};
  if (profileCandidate) {
    const firstName = getText(profileCandidate, "firstName") ?? "";
    const lastName = getText(profileCandidate, "lastName") ?? "";
    const name = `${firstName} ${lastName}`.trim();
    if (name) profile.name = name;
    assignText(profile, "headline", getText(profileCandidate, "headline"));
    assignText(
      profile,
      "location",
      getText(profileCandidate, "geoLocationName") ?? getText(profileCandidate, "locationName")
    );
    assignText(profile, "about", getText(profileCandidate, "summary"));
    const profileImageUrl = imageUrl(profileCandidate.profilePicture ?? profileCandidate.displayPicture);
    const backgroundImageUrl = imageUrl(profileCandidate.backgroundPicture);
    if (profileImageUrl) profile.profileImageUrl = profileImageUrl;
    if (backgroundImageUrl) profile.backgroundImageUrl = backgroundImageUrl;
  }

  const targetMemberId = profileCandidate ? memberId(profileCandidate) : undefined;
  const targetObjects = targetMemberId
    ? objects.filter((object) => object === profileCandidate || referencesMember(object, targetMemberId))
    : [];

  const experience = uniqueBy(
    targetObjects
      .filter(isExperience)
      .map(toExperience)
      .filter((value): value is Experience => value !== undefined),
    (value) => `${value.title}|${value.company ?? ""}|${value.dateRange?.startDate ?? ""}`
  );
  const education = uniqueBy(
    targetObjects
      .filter(isEducation)
      .map(toEducation)
      .filter((value): value is Education => value !== undefined),
    (value) => `${value.school}|${value.degree ?? ""}|${value.dateRange?.startDate ?? ""}`
  );
  const skills = uniqueBy(
    targetObjects.filter(isSkill).map((object) => getText(object, "name")).filter((value): value is string => !!value),
    (value) => value.toLocaleLowerCase()
  );
  const certifications = uniqueBy(
    targetObjects
      .filter(isCertification)
      .map(toCertification)
      .filter((value): value is Certification => value !== undefined),
    (value) => `${value.name}|${value.issuingOrganization ?? ""}`
  );
  const languages = uniqueBy(
    targetObjects
      .filter(isLanguage)
      .map(toLanguage)
      .filter((value): value is Language => value !== undefined),
    (value) => value.name.toLocaleLowerCase()
  );

  return { profile, experience, education, skills, certifications, languages };
}

function collectObjects(root: unknown): JsonObject[] {
  const found: JsonObject[] = [];
  const seen = new Set<object>();
  const queue: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  let cursor = 0;
  while (cursor < queue.length && found.length < 20_000) {
    const next = queue[cursor];
    cursor += 1;
    if (!next || next.depth > 20 || typeof next.value !== "object" || next.value === null || seen.has(next.value)) {
      continue;
    }
    seen.add(next.value);
    if (Array.isArray(next.value)) {
      for (const value of next.value) queue.push({ value, depth: next.depth + 1 });
    } else {
      found.push(next.value as JsonObject);
      for (const value of Object.values(next.value)) queue.push({ value, depth: next.depth + 1 });
    }
  }
  return found;
}

function memberId(object: JsonObject): string | undefined {
  for (const value of identityReferences(object)) {
    const match = /urn:li:(?:fsd_profile|fs_miniProfile):([^,)]+)/i.exec(value);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function referencesMember(object: JsonObject, targetMemberId: string): boolean {
  return identityReferences(object).some((value) => value.includes(targetMemberId));
}

function identityReferences(object: JsonObject): string[] {
  return Object.entries(object).flatMap(([key, value]) => {
    if (!/(?:entity|profile|member|miniProfile)(?:Urn|Id)$|^publicIdentifier$/i.test(key)) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
    return [];
  });
}

function isExperience(object: JsonObject): boolean {
  return (
    getText(object, "title") !== undefined &&
    (getText(object, "companyName") !== undefined || getText(object, "companyUrn") !== undefined) &&
    entityType(object).includes("position")
  );
}

function toExperience(object: JsonObject): Experience | undefined {
  const title = getText(object, "title");
  if (!title) return undefined;
  const result: Experience = { title, skills: [] };
  assignText(result, "company", getText(object, "companyName"));
  assignText(result, "employmentType", getText(object, "employmentType"));
  assignText(result, "location", getText(object, "locationName"));
  assignText(result, "description", getText(object, "description"));
  const dateRange = readDateRange(object.dateRange ?? object.timePeriod);
  if (dateRange) result.dateRange = dateRange;
  const logo = imageUrl(object.companyLogo ?? object.logo);
  if (logo) result.companyLogoUrl = logo;
  return result;
}

function isEducation(object: JsonObject): boolean {
  return (
    (getText(object, "schoolName") !== undefined || getText(object, "schoolUrn") !== undefined) &&
    entityType(object).includes("education")
  );
}

function toEducation(object: JsonObject): Education | undefined {
  const school = getText(object, "schoolName");
  if (!school) return undefined;
  const result: Education = { school };
  assignText(result, "degree", getText(object, "degreeName"));
  assignText(result, "fieldOfStudy", getText(object, "fieldOfStudy"));
  assignText(result, "grade", getText(object, "grade"));
  assignText(result, "activities", getText(object, "activities"));
  assignText(result, "description", getText(object, "description"));
  const dateRange = readDateRange(object.dateRange ?? object.timePeriod);
  if (dateRange) result.dateRange = dateRange;
  const logo = imageUrl(object.schoolLogo ?? object.logo);
  if (logo) result.schoolLogoUrl = logo;
  return result;
}

function isSkill(object: JsonObject): boolean {
  return getText(object, "name") !== undefined && entityType(object).includes("skill");
}

function isCertification(object: JsonObject): boolean {
  const type = entityType(object);
  return getText(object, "name") !== undefined && (type.includes("certification") || type.includes("license"));
}

function toCertification(object: JsonObject): Certification | undefined {
  const name = getText(object, "name");
  if (!name) return undefined;
  const result: Certification = { name };
  assignText(
    result,
    "issuingOrganization",
    getText(object, "authority") ?? getText(object, "issuingOrganization")
  );
  assignText(result, "credentialId", getText(object, "licenseNumber") ?? getText(object, "credentialId"));
  const url = getText(object, "url");
  if (url && isHttpsUrl(url)) result.credentialUrl = url;
  const range = readDateRange(object.dateRange ?? object.timePeriod);
  if (range?.startDate) result.issueDate = range.startDate;
  if (range?.endDate) result.expirationDate = range.endDate;
  return result;
}

function isLanguage(object: JsonObject): boolean {
  return getText(object, "name") !== undefined && entityType(object).includes("language");
}

function toLanguage(object: JsonObject): Language | undefined {
  const name = getText(object, "name");
  if (!name) return undefined;
  const result: Language = { name };
  assignText(result, "proficiency", getText(object, "proficiency"));
  return result;
}

function entityType(object: JsonObject): string {
  return [object.entityUrn, object.trackingUrn, object.$type, object.template]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();
}

function readDateRange(value: unknown): DateRange | undefined {
  if (!isObject(value)) return undefined;
  const startDate = formatDate(value.start ?? value.startDate);
  const endDate = formatDate(value.end ?? value.endDate);
  if (!startDate && !endDate) return undefined;
  return { ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
}

function formatDate(value: unknown): string | undefined {
  if (!isObject(value)) return undefined;
  const year = typeof value.year === "number" ? value.year : undefined;
  const month = typeof value.month === "number" ? value.month : undefined;
  if (!year) return undefined;
  return month ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}` : String(year);
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return isHttpsUrl(value) ? value : undefined;
  if (!isObject(value)) return undefined;
  const rootUrl = getText(value, "rootUrl") ?? getText(value, "url");
  const artifacts = Array.isArray(value.artifacts) ? value.artifacts.filter(isObject) : [];
  const largest = [...artifacts].sort(
    (left, right) => numberValue(right.width) * numberValue(right.height) - numberValue(left.width) * numberValue(left.height)
  )[0];
  const segment = largest ? getText(largest, "fileIdentifyingUrlPathSegment") : undefined;
  const combined = rootUrl && segment ? `${rootUrl}${segment}` : rootUrl;
  return combined && isHttpsUrl(combined) ? combined : undefined;
}

function getText(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  if (typeof value === "string") return value.trim() || undefined;
  if (isObject(value)) {
    for (const nestedKey of ["text", "localized", "preferredLocale"]) {
      const nested = value[nestedKey];
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
    const localized = Object.values(value).find((entry) => typeof entry === "string" && entry.trim());
    if (typeof localized === "string") return localized.trim();
  }
  return undefined;
}

function assignText<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function uniqueBy<T>(values: T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const identifier = key(value);
    if (seen.has(identifier)) return false;
    seen.add(identifier);
    return true;
  });
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function numberValue(value: unknown): number {
  return typeof value === "number" ? value : 0;
}
