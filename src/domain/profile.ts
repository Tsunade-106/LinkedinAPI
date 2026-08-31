import { z } from "zod";

const optionalText = z.string().trim().min(1).max(20_000).optional();
const urlSchema = z.url().max(4_096);

export const dateRangeSchema = z.object({
  startDate: optionalText,
  endDate: optionalText,
  duration: optionalText
});

export const experienceSchema = z.object({
  title: z.string().min(1).max(500),
  company: optionalText,
  employmentType: optionalText,
  location: optionalText,
  dateRange: dateRangeSchema.optional(),
  description: optionalText,
  skills: z.array(z.string().min(1).max(500)).max(100).default([]),
  companyUrl: urlSchema.optional(),
  companyLogoUrl: urlSchema.optional()
});

export const educationSchema = z.object({
  school: z.string().min(1).max(500),
  degree: optionalText,
  fieldOfStudy: optionalText,
  dateRange: dateRangeSchema.optional(),
  grade: optionalText,
  activities: optionalText,
  description: optionalText,
  schoolUrl: urlSchema.optional(),
  schoolLogoUrl: urlSchema.optional()
});

export const certificationSchema = z.object({
  name: z.string().min(1).max(500),
  issuingOrganization: optionalText,
  issueDate: optionalText,
  expirationDate: optionalText,
  credentialId: optionalText,
  credentialUrl: urlSchema.optional()
});

export const languageSchema = z.object({
  name: z.string().min(1).max(500),
  proficiency: optionalText
});

export const profileSchema = z.object({
  profileUrl: urlSchema,
  name: z.string().min(1).max(500),
  headline: optionalText,
  location: optionalText,
  about: optionalText,
  profileImageUrl: urlSchema.optional(),
  backgroundImageUrl: urlSchema.optional(),
  experience: z.array(experienceSchema).max(100).default([]),
  education: z.array(educationSchema).max(100).default([]),
  skills: z.array(z.string().min(1).max(500)).max(500).default([]),
  certifications: z.array(certificationSchema).max(200).default([]),
  languages: z.array(languageSchema).max(100).default([])
});

export type DateRange = z.infer<typeof dateRangeSchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type Language = z.infer<typeof languageSchema>;
export type Profile = z.infer<typeof profileSchema>;

export interface ProfileResult {
  data: Profile;
  meta: {
    requestId: string;
    fetchedAt: string;
    cache: "hit" | "miss";
    extractionMode: "authenticated" | "public";
    completeness: number;
    warnings: string[];
  };
}
