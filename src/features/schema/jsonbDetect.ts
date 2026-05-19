/**
 * — predicate for JSONB column detection in SchemaTree.
 * Used to gate the inferred-schema panel chevron.
 */
export function isJsonbType(dataType: string): boolean {
  const t = dataType.toLowerCase().trim();
  return t === "jsonb" || t === "json";
}
