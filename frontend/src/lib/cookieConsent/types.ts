export type CookieCategoryId = "necessary" | "analytics";

export interface CookieCategoryDefinition {
  id: CookieCategoryId;
  required: boolean;
}

export type ConsentSelections = Record<CookieCategoryId, boolean>;

export interface ConsentRecord {
  version: number;
  timestamp: string;
  categories: ConsentSelections;
}
