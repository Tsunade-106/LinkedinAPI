import { AppError } from "../domain/errors.js";

const LINKEDIN_HOST = /^(?:(?:www|[a-z]{2})\.)?linkedin\.com$/i;
const PROFILE_PATH = /^\/in\/([^/?#]+)\/?(?:.*)?$/i;
const SAFE_SLUG = /^[\p{L}\p{N}._~-]{2,120}$/u;

export function normalizeLinkedInProfileUrl(input: string): string {
  if (input.length > 2_048) {
    throw invalidUrl();
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidUrl();
  }

  if (
    url.protocol !== "https:" ||
    !isLinkedInHost(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== ""
  ) {
    throw invalidUrl();
  }

  const match = PROFILE_PATH.exec(url.pathname);
  const encodedSlug = match?.[1];
  if (encodedSlug === undefined) {
    throw invalidUrl();
  }

  let slug: string;
  try {
    slug = decodeURIComponent(encodedSlug);
  } catch {
    throw invalidUrl();
  }

  if (!SAFE_SLUG.test(slug) || slug === "." || slug === "..") {
    throw invalidUrl();
  }

  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`;
}

export function isLinkedInHost(hostname: string): boolean {
  return LINKEDIN_HOST.test(hostname);
}

function invalidUrl(): AppError {
  return new AppError(
    "INVALID_PROFILE_URL",
    "profileUrl must be an HTTPS LinkedIn /in/ profile URL",
    400
  );
}
