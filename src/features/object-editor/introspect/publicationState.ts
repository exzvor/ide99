// — PublicationDefinitionDto → PublicationForm transform.
//
// Postgres exposes three publication shapes via pg_publication: FOR ALL
// TABLES, FOR TABLES IN SCHEMA, and FOR TABLE list. We collapse those onto
// the form's `mode` discriminator and stamp UUIDs onto each table row so the
// editor can detect re-orders / renames vs. drop+add.

import type { PublicationDefinitionDto } from "../../../lib/tauri";
import type { PublicationForm, PublicationMode } from "../ddl/types";

export function fromDefinition(def: PublicationDefinitionDto): PublicationForm {
  let mode: PublicationMode;
  if (def.allTables) mode = "all_tables";
  else if (def.schemas.length > 0) mode = "schemas";
  else mode = "tables";
  return {
    name: def.name,
    mode,
    schemas: [...def.schemas],
    tables: def.tables.map((q) => ({
      id: crypto.randomUUID(),
      schema: q.schema,
      name: q.name,
    })),
    publishInsert: def.publishInsert,
    publishUpdate: def.publishUpdate,
    publishDelete: def.publishDelete,
    publishTruncate: def.publishTruncate,
    publishViaPartitionRoot: def.publishViaPartitionRoot,
    comment: def.comment ?? null,
  };
}
