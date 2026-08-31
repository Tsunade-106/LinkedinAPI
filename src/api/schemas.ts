export const profileRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profileUrl"],
  properties: {
    profileUrl: {
      type: "string",
      format: "uri",
      maxLength: 2_048,
      examples: ["https://www.linkedin.com/in/example-person/"]
    },
    refresh: {
      type: "boolean",
      default: false,
      description: "Bypass a completed cache entry. Concurrent requests are still coalesced."
    }
  }
} as const;

const dateRange = {
  type: "object",
  additionalProperties: false,
  properties: {
    startDate: { type: "string" },
    endDate: { type: "string" },
    duration: { type: "string" }
  }
} as const;

export const profileResponseSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "object",
      required: ["profileUrl", "name", "experience", "education", "skills", "certifications", "languages"],
      properties: {
        profileUrl: { type: "string", format: "uri" },
        name: { type: "string" },
        headline: { type: "string" },
        location: { type: "string" },
        about: { type: "string" },
        profileImageUrl: { type: "string", format: "uri" },
        backgroundImageUrl: { type: "string", format: "uri" },
        experience: {
          type: "array",
          items: {
            type: "object",
            required: ["title", "skills"],
            properties: {
              title: { type: "string" },
              company: { type: "string" },
              employmentType: { type: "string" },
              location: { type: "string" },
              dateRange,
              description: { type: "string" },
              skills: { type: "array", items: { type: "string" } },
              companyUrl: { type: "string", format: "uri" },
              companyLogoUrl: { type: "string", format: "uri" }
            }
          }
        },
        education: {
          type: "array",
          items: {
            type: "object",
            required: ["school"],
            properties: {
              school: { type: "string" },
              degree: { type: "string" },
              fieldOfStudy: { type: "string" },
              dateRange,
              grade: { type: "string" },
              activities: { type: "string" },
              description: { type: "string" },
              schoolUrl: { type: "string", format: "uri" },
              schoolLogoUrl: { type: "string", format: "uri" }
            }
          }
        },
        skills: { type: "array", items: { type: "string" } },
        certifications: {
          type: "array",
          items: {
            type: "object",
            required: ["name"],
            properties: {
              name: { type: "string" },
              issuingOrganization: { type: "string" },
              issueDate: { type: "string" },
              expirationDate: { type: "string" },
              credentialId: { type: "string" },
              credentialUrl: { type: "string", format: "uri" }
            }
          }
        },
        languages: {
          type: "array",
          items: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string" }, proficiency: { type: "string" } }
          }
        }
      }
    },
    meta: {
      type: "object",
      required: ["requestId", "fetchedAt", "cache", "extractionMode", "completeness", "warnings"],
      properties: {
        requestId: { type: "string" },
        fetchedAt: { type: "string", format: "date-time" },
        cache: { type: "string", enum: ["hit", "miss"] },
        extractionMode: { type: "string", enum: ["authenticated", "public"] },
        completeness: { type: "integer", minimum: 0, maximum: 100 },
        warnings: { type: "array", items: { type: "string" } }
      }
    }
  }
} as const;

export const errorResponseSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message", "retryable", "requestId"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        retryable: { type: "boolean" },
        requestId: { type: "string" }
      }
    }
  }
} as const;
