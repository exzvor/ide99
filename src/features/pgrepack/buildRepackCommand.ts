// — owner: .
export type RepackForm = {
  host: string;
  port?: number;
  database: string;
  schema: string;
  table: string;
  jobs?: number;
  noSuperuserCheck?: boolean;
  onlyIndexes?: boolean;
};

export function buildRepackCommand(form: RepackForm): string {
  const parts: string[] = ["pg_repack"];
  parts.push(`-h ${form.host}`);
  if (form.port !== undefined) parts.push(`-p ${form.port}`);
  parts.push(`-d ${form.database}`);
  parts.push(`-t ${form.schema}.${form.table}`);
  if (form.jobs !== undefined) parts.push(`--jobs ${form.jobs}`);
  if (form.noSuperuserCheck) parts.push("--no-superuser-check");
  if (form.onlyIndexes) parts.push("--only-indexes");
  return parts.join(" ");
}
