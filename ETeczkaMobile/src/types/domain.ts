export const retentionUnits = ["years", "months", "days", "minutes"] as const;

export type RetentionUnit = (typeof retentionUnits)[number];

export function isRetentionUnit(value: unknown): value is RetentionUnit {
  return typeof value === "string" && retentionUnits.includes(value as RetentionUnit);
}
