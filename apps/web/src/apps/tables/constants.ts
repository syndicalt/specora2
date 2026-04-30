import type { ColumnDef, FilterOperator } from "./types";

export const PAGE_SIZE = 100;
export const IMPORT_LIMIT = 250;
export const REFERENCE_OPTIONS_LIMIT = 500;
export const TABLES_LAUNCH_KEY = "specora_tables_launch";

export const SELECT_CLASS = "appearance-none rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 pr-8 text-sm text-gray-100 outline-none [color-scheme:dark] focus:border-indigo-500 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-500";
export const INLINE_SELECT_CLASS = "w-full min-w-32 appearance-none rounded border border-indigo-500 bg-gray-950 px-2 py-1 pr-8 text-sm text-gray-100 outline-none [color-scheme:dark] focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";

export const RELATIONSHIP_TYPES = ["PART_OF", "DEPENDS_ON", "HOSTED_ON", "MANAGED_BY", "OWNED_BY", "LOCATED_AT"];
export const RELATIONSHIP_FILTERS: ColumnDef[] = [
  { key: "__relationshipState", label: "Relationship State", core: false, attrType: "relationship-state" },
  { key: "__relationshipType", label: "Relationship Type", core: false, attrType: "relationship-type" },
  { key: "__relatedCiId", label: "Related CI ID", core: false, attrType: "string" },
];
export const RELATIONSHIP_FILTER_KEYS = new Set(RELATIONSHIP_FILTERS.map((filter) => filter.key));

export const OPERATORS: Array<{ value: FilterOperator; label: string; needsValue: boolean }> = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "equals", label: "equals", needsValue: true },
  { value: "notEquals", label: "not equals", needsValue: true },
  { value: "startsWith", label: "starts with", needsValue: true },
  { value: "endsWith", label: "ends with", needsValue: true },
  { value: "empty", label: "is empty", needsValue: false },
  { value: "notEmpty", label: "is not empty", needsValue: false },
  { value: "gt", label: "greater than", needsValue: true },
  { value: "gte", label: "greater/equal", needsValue: true },
  { value: "lt", label: "less than", needsValue: true },
  { value: "lte", label: "less/equal", needsValue: true },
];

