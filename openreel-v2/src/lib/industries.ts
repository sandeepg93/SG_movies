import type { Industry } from "@/types/movie";

export interface IndustryInfo {
  value: Industry;
  label: string;
  language: string;
  tagline: string;
}

// "Tollywood" here means Telugu cinema. Change the language/tagline if you mean Bengali cinema.
export const INDUSTRIES: IndustryInfo[] = [
  { value: "hollywood", label: "Hollywood", language: "English", tagline: "Classic American cinema" },
  { value: "bollywood", label: "Bollywood", language: "Hindi", tagline: "Hindi cinema" },
  { value: "marathi", label: "Marathi", language: "Marathi", tagline: "Marathi cinema" },
  { value: "tollywood", label: "Tollywood", language: "Telugu", tagline: "Telugu cinema" },
];

export const INDUSTRY_VALUES: readonly string[] = INDUSTRIES.map((i) => i.value);

export function industryLabel(value: string): string {
  const found = INDUSTRIES.find((i) => i.value === value);
  return found ? found.label : value;
}
