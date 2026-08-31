import type { Page } from "playwright";
import type { DomSnapshot } from "./types.js";

export async function expandVisibleSections(page: Page): Promise<void> {
  const buttons = page.getByRole("button", { name: /see more|show more/i });
  const count = Math.min(await buttons.count(), 12);
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    try {
      if (await button.isVisible()) await button.click({ timeout: 750 });
    } catch {
      // Expansion is best-effort; the unexpanded text remains usable.
    }
  }
}

export async function extractDomSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
    const text = (selector: string): string | undefined => {
      const value = normalize(document.querySelector<HTMLElement>(selector)?.innerText);
      return value || undefined;
    };
    const source = (selector: string): string | undefined => {
      const element = document.querySelector<HTMLImageElement>(selector);
      const currentSrc = element?.currentSrc;
      const value = currentSrc?.length ? currentSrc : element?.src;
      return value && /^https?:\/\//.test(value) ? value : undefined;
    };
    const linesOf = (element: Element): string[] => {
      const raw = normalize((element as HTMLElement).innerText);
      return raw
        .split(/\n+/)
        .map(normalize)
        .filter((line, index, all) => line.length > 0 && all.indexOf(line) === index)
        .slice(0, 80);
    };

    const sections = [...document.querySelectorAll<HTMLElement>("main section")].map((section) => {
      const headingElement = section.querySelector<HTMLElement>("h2, h3");
      const heading = normalize(headingElement?.innerText);
      const candidates = [...section.querySelectorAll<HTMLElement>(":scope li")];
      const cards = candidates
        .map(linesOf)
        .filter((lines) => lines.length > 0 && lines.join(" ").length > 2)
        .slice(0, 200);
      return {
        heading,
        cards: cards.length > 0 ? cards : [linesOf(section)],
        text: normalize(section.innerText).slice(0, 30_000)
      };
    });

    const jsonLd: unknown[] = [];
    for (const script of document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]')) {
      try {
        jsonLd.push(JSON.parse(script.text) as unknown);
      } catch {
        // Invalid structured-data blocks do not invalidate the page.
      }
    }

    const main = document.querySelector<HTMLElement>("main");
    const detailName = /\/details\/(experience|education|skills|certifications|languages)\/?/i.exec(
      window.location.pathname
    )?.[1];
    const detailSections = main ? [...main.querySelectorAll<HTMLElement>("section")] : [];
    const detailRoot = detailName
      ? detailSections.find((section) =>
          normalize(section.querySelector<HTMLElement>("h1, h2, h3")?.innerText)
            .toLocaleLowerCase()
            .includes(detailName.replace(/s$/, ""))
        ) ?? detailSections[0]
      : undefined;
    const mainCards = detailRoot
      ? [...detailRoot.querySelectorAll<HTMLElement>(":scope li")]
          .map(linesOf)
          .filter((lines) => lines.length > 0)
          .slice(0, 200)
      : [];

    const name =
      text("main h1") ??
      text(".top-card-layout__title") ??
      text("h1.top-card-layout__title");
    const headline =
      text(".top-card-layout__headline") ??
      text("main .text-body-medium.break-words") ??
      text("main [data-generated-suggestion-target]");
    const location =
      text(".top-card-layout__first-subline") ??
      text("main .text-body-small.inline.t-black--light.break-words") ??
      text("main .pv-text-details__left-panel + .pv-text-details__left-panel span");
    const profileImageUrl = source(
      ".pv-top-card-profile-picture__image, .top-card__profile-image, main img[alt*='profile' i], main img[alt*='photo' i]"
    );
    const backgroundImageUrl = source(
      ".profile-background-image__image-container img, .profile-background-image img, .top-card-layout__card img.top-card__background-image"
    );

    return {
      pageUrl: window.location.href,
      ...(name ? { name } : {}),
      ...(headline ? { headline } : {}),
      ...(location ? { location } : {}),
      ...(profileImageUrl ? { profileImageUrl } : {}),
      ...(backgroundImageUrl ? { backgroundImageUrl } : {}),
      jsonLd,
      sections,
      mainCards
    };
  });
}
