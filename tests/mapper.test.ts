import { describe, expect, it } from "vitest";
import { calculateCompleteness, mapExtraction } from "../src/extractor/mapper.js";
import type { RawExtraction } from "../src/extractor/types.js";

function fixture(): RawExtraction {
  return {
    profileUrl: "https://www.linkedin.com/in/jane-doe/",
    authenticated: true,
    warnings: [],
    voyagerPayloads: [
      {
        included: [
          {
            $type: "com.linkedin.voyager.identity.profile.Profile",
            entityUrn: "urn:li:fsd_profile:ACoViewer",
            publicIdentifier: "signed-in-viewer",
            firstName: "Wrong",
            lastName: "Person",
            headline: "This identity must not leak"
          },
          {
            entityUrn: "urn:li:fsd_profilePosition:(ACoViewer,99)",
            title: "Unrelated Job",
            companyName: "Wrong Corp"
          },
          {
            $type: "com.linkedin.voyager.identity.profile.Profile",
            entityUrn: "urn:li:fsd_profile:ACoTarget",
            publicIdentifier: "jane-doe",
            firstName: "Jane",
            lastName: "Doe",
            headline: "Staff Software Engineer",
            geoLocationName: "Bengaluru, India",
            summary: "I build reliable distributed systems.",
            profilePicture: {
              rootUrl: "https://media.example/",
              artifacts: [
                { width: 100, height: 100, fileIdentifyingUrlPathSegment: "small.jpg" },
                { width: 400, height: 400, fileIdentifyingUrlPathSegment: "large.jpg" }
              ]
            }
          },
          {
            entityUrn: "urn:li:fsd_profilePosition:(ACoTarget,1)",
            title: "Staff Software Engineer",
            companyName: "Example Corp",
            employmentType: "Full-time",
            locationName: "Bengaluru",
            dateRange: { start: { month: 1, year: 2022 } }
          },
          { entityUrn: "urn:li:fsd_profileSkill:(ACoTarget,1)", name: "TypeScript" },
          { entityUrn: "urn:li:fsd_profileSkill:(ACoViewer,2)", name: "Private Viewer Skill" }
        ]
      }
    ],
    base: {
      pageUrl: "https://www.linkedin.com/in/jane-doe/",
      name: "Jane Doe",
      headline: "Staff Software Engineer",
      jsonLd: [],
      mainCards: [],
      sections: [
        { heading: "About", cards: [], text: "About\nI build reliable distributed systems." },
        {
          heading: "Education",
          text: "Education",
          cards: [["Example University", "B.Tech, Computer Science", "2013 - 2017"]]
        },
        {
          heading: "Licenses & certifications",
          text: "Licenses & certifications",
          cards: [["Cloud Architect", "Cloud Foundation", "Issued Jan 2024", "Credential ID ABC"]]
        },
        { heading: "Languages", text: "Languages", cards: [["English", "Professional working proficiency"]] }
      ]
    },
    details: {}
  };
}

describe("mapExtraction", () => {
  it("combines captured browser data with semantic DOM fallback", () => {
    const result = mapExtraction(fixture());

    expect(result.profile).toMatchObject({
      name: "Jane Doe",
      location: "Bengaluru, India",
      profileImageUrl: "https://media.example/large.jpg",
      skills: ["TypeScript"]
    });
    expect(result.profile.experience[0]).toMatchObject({
      title: "Staff Software Engineer",
      company: "Example Corp",
      dateRange: { startDate: "2022-01" }
    });
    expect(result.profile.experience.some((entry) => entry.title === "Unrelated Job")).toBe(false);
    expect(result.profile.skills).not.toContain("Private Viewer Skill");
    expect(result.profile.education[0]).toMatchObject({ school: "Example University", degree: "B.Tech" });
    expect(result.profile.certifications[0]?.credentialId).toBe("ABC");
    expect(result.profile.languages[0]?.name).toBe("English");
    expect(calculateCompleteness(result.profile)).toBe(100);
  });

  it("fails safely when the returned page is not a profile", () => {
    const raw = fixture();
    delete raw.base.name;
    raw.voyagerPayloads = [];
    expect(() => mapExtraction(raw)).toThrow(/no profile identity/i);
  });

  it("maps public JSON-LD and detail-card fallbacks without Voyager data", () => {
    const raw = fixture();
    raw.authenticated = false;
    raw.voyagerPayloads = [];
    raw.base.name = "Fallback Name";
    raw.base.jsonLd = [
      {
        "@graph": [
          {
            "@type": "Person",
            name: "Public Person",
            jobTitle: "Principal Engineer",
            description: "Public description",
            image: { url: "https://images.example/person.jpg" },
            address: { addressLocality: "Pune, India" },
            alumniOf: { name: "Public University" }
          }
        ]
      }
    ];
    raw.details = {
      experience: {
        pageUrl: `${raw.profileUrl}details/experience/`,
        jsonLd: [],
        sections: [],
        mainCards: [
          [
            "Principal Engineer",
            "Public Corp · Full-time",
            "Jan 2024 - Present · 2 yrs",
            "Pune, India · Hybrid",
            "Built a platform.",
            "Skills: Go, Kubernetes"
          ]
        ]
      },
      skills: {
        pageUrl: `${raw.profileUrl}details/skills/`,
        jsonLd: [],
        sections: [],
        mainCards: [["Go", "2 endorsements"], ["Kubernetes"]]
      }
    };

    const result = mapExtraction(raw);
    expect(result.extractionMode).toBe("public");
    expect(result.profile).toMatchObject({
      name: "Public Person",
      headline: "Principal Engineer",
      location: "Pune, India",
      about: "Public description",
      profileImageUrl: "https://images.example/person.jpg"
    });
    expect(result.profile.experience[0]).toMatchObject({
      company: "Public Corp",
      employmentType: "Full-time",
      dateRange: { startDate: "Jan 2024", endDate: "Present", duration: "2 yrs" },
      skills: ["Go", "Kubernetes"]
    });
    expect(result.profile.education.some((entry) => entry.school === "Public University")).toBe(true);
    expect(result.profile.skills).toEqual(["Go", "Kubernetes"]);
  });
});
