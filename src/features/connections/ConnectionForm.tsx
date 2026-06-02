import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import { type JSX, useCallback, useEffect, useMemo, useState } from "react";
import { FormProvider, useForm, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { Dialog } from "../../components/Dialog";
import { Field } from "../../components/Field";
import { Select } from "../../components/Select";
import { useToast } from "../../components/Toast";
import { localizeConnectionError } from "../../lib/errors";
import { instantDbDelete } from "../../lib/instantDb";
import { shortServerVersion } from "../../lib/serverVersion";
import {
  type Connection,
  type Environment,
  type SslMode,
  type TestResult,
  connectionRecordTestResult,
  createConnection,
  listDatabases,
  listDatabasesForEdit,
  testConnection,
  testConnectionForEdit,
  updateConnection,
} from "../../lib/tauri";
import { useSchema } from "../schema/store";
import { EnvironmentSelect } from "./EnvironmentSelect";
import { useConnections } from "./store";

/**
 * <ConnectionForm /> — modal dialog for create + edit.
 *
 * Mounted at App level; renders nothing when `formMode.type === "closed"`.
 * Reads + writes via the Zustand store contract:
 * - `formMode`: `{type:"closed"} | {type:"create",prefill?} | {type:"edit",id}`
 * - `connections`: `Connection[]`
 * - `closeForm()`: dismisses the modal
 * - `upsertLocal(conn)`: optimistically reflects backend writes
 *
 * The form delegates persistence to `lib/tauri.ts` (createConnection /
 * updateConnection / testConnection) — those typed wrappers handle the
 * Tauri invoke + zod runtime check.
 */

const SSL_MODES: SslMode[] = ["disable", "allow", "prefer", "require", "verify-ca", "verify-full"];

interface FormValues {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslMode: SslMode;
  saveWithoutTesting: boolean;
  excludeFromHistory: boolean;
  excludeFromRecentPlans: boolean;
  environment: Environment;
  readOnly: boolean;
  slowQueryWarning: boolean;
  confirmDestructive: boolean;
}

interface BuildSchemaArgs {
  t: (key: string) => string;
  existingNames: { id: string; name: string }[];
  /** id of the row being edited; undefined in create mode. */
  editingId: string | undefined;
}

function buildSchema({ t, existingNames, editingId }: BuildSchemaArgs) {
  return z.object({
    name: z
      .string()
      .min(1, t("connection.form.error.name_required"))
      .max(80)
      .refine(
        (value) => !existingNames.some((entry) => entry.name === value && entry.id !== editingId),
        { message: t("connection.form.error.name_taken") },
      ),
    host: z.string().min(1, t("connection.form.error.host_required")),
    port: z.coerce
      .number({ invalid_type_error: t("connection.form.error.port_invalid") })
      .int(t("connection.form.error.port_invalid"))
      .min(1, t("connection.form.error.port_invalid"))
      .max(65535, t("connection.form.error.port_invalid")),
    database: z.string().min(1, t("connection.form.error.database_required")),
    username: z.string().min(1, t("connection.form.error.user_required")),
    password: z.string().optional().default(""),
    sslMode: z.enum(["disable", "allow", "prefer", "require", "verify-ca", "verify-full"]),
    saveWithoutTesting: z.boolean().default(false),
    excludeFromHistory: z.boolean().default(false),
    excludeFromRecentPlans: z.boolean().default(false),
    environment: z.enum(["local", "dev", "stage", "prod"]).default("local"),
    readOnly: z.boolean().default(false),
    slowQueryWarning: z.boolean().default(false),
    confirmDestructive: z.boolean().default(false),
  });
}

type TestUiState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "success"; result: TestResult }
  | { status: "failure"; result: TestResult };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isRemoteHost(host: string): boolean {
  return !LOCAL_HOSTS.has(host.trim());
}

function defaultsForCreate(prefill: Partial<FormValues> | undefined): FormValues {
  return {
    name: prefill?.name ?? "",
    host: prefill?.host ?? "localhost",
    port: prefill?.port ?? 5432,
    database: prefill?.database ?? "postgres",
    username: prefill?.username ?? "",
    password: prefill?.password ?? "",
    sslMode: prefill?.sslMode ?? "prefer",
    saveWithoutTesting: false,
    excludeFromHistory: prefill?.excludeFromHistory ?? false,
    excludeFromRecentPlans: prefill?.excludeFromRecentPlans ?? false,
    environment: prefill?.environment ?? "local",
    readOnly: prefill?.readOnly ?? false,
    slowQueryWarning: prefill?.slowQueryWarning ?? false,
    confirmDestructive: prefill?.confirmDestructive ?? false,
  };
}

function defaultsForEdit(connection: Connection): FormValues {
  return {
    name: connection.name,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    password: "",
    sslMode: connection.sslMode,
    saveWithoutTesting: false,
    excludeFromHistory: connection.excludeFromHistory,
    excludeFromRecentPlans: connection.excludeFromRecentPlans,
    environment: connection.environment,
    readOnly: connection.readOnly,
    slowQueryWarning: connection.slowQueryWarning,
    confirmDestructive: connection.confirmDestructive,
  };
}

export function ConnectionForm() {
  const { t } = useTranslation();
  const toast = useToast();

  const formMode = useConnections((state) => state.formMode);
  const closeForm = useConnections((state) => state.closeForm);
  const upsertLocal = useConnections((state) => state.upsertLocal);
  const connections = useConnections((state) => state.connections);

  const isOpen = formMode.type !== "closed";
  const editingConnection: Connection | undefined =
    formMode.type === "edit" ? connections.find((c) => c.id === formMode.id) : undefined;

  const editingId = editingConnection?.id;
  const existingNames = useMemo(
    () => connections.map((c) => ({ id: c.id, name: c.name })),
    [connections],
  );

  const schema = useMemo(
    () => buildSchema({ t, existingNames, editingId }),
    [t, existingNames, editingId],
  );

  const initialValues: FormValues = useMemo(() => {
    if (formMode.type === "edit" && editingConnection) return defaultsForEdit(editingConnection);
    if (formMode.type === "create") {
      return defaultsForCreate(formMode.prefill as Partial<FormValues> | undefined);
    }
    return defaultsForCreate(undefined);
  }, [formMode, editingConnection]);

  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
    mode: "onBlur",
  });

  const [testState, setTestState] = useState<TestUiState>({ status: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // #24 — databases fetched by the "browse databases" affordance, fed to a
  // <datalist> so the Database field offers type-ahead from the real list.
  const [databaseOptions, setDatabaseOptions] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  // Orphan-Instant-DB tracker: snapshotted from prefill at open time. While
  // this is non-null, abandoning the form (cancel/discard/X) drops the
  // server-side DB so the per-device active-DB quota does not block the next
  // attempt. Cleared on successful save (the user is actually using it).
  const [pendingInstantDbId, setPendingInstantDbId] = useState<string | null>(null);

  // Reset values whenever the open mode changes (create vs edit vs different id).
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on mode/id only — methods identity is stable, initialValues is memoized through it.
  useEffect(() => {
    methods.reset(initialValues);
    setTestState({ status: "idle" });
    setShowDiscardConfirm(false);
    setSubmitting(false);
    setShowPassword(false);
    setPendingInstantDbId(
      formMode.type === "create" ? (formMode.prefill?.instantDbId ?? null) : null,
    );
  }, [formMode.type, editingId]);

  const cancelAndCleanup = useCallback(() => {
    if (pendingInstantDbId) {
      const id = pendingInstantDbId;
      setPendingInstantDbId(null);
      // Fire-and-forget — the user has already decided to abandon; surfacing
      // a delete failure here would just block them on a server they've
      // chosen to walk away from. The control service also TTLs orphans.
      void instantDbDelete(id).catch(() => undefined);
    }
    closeForm();
  }, [pendingInstantDbId, closeForm]);

  const watchedHost = methods.watch("host");
  const watchedSslMode = methods.watch("sslMode");
  const showSslWarning = watchedSslMode === "disable" && isRemoteHost(watchedHost ?? "");

  // Field-edit invalidates a previous test result.
  useEffect(() => {
    const subscription = methods.watch((_value, info) => {
      if (info.name && info.type === "change") {
        setTestState((prev) => (prev.status === "idle" ? prev : { status: "idle" }));
      }
    });
    return () => subscription.unsubscribe();
  }, [methods]);

  const handleTest = useCallback(async () => {
    // "Test connection" is about reachability/auth, not save-time form
    // completeness. Clear any pre-existing name error (e.g. blurred from the
    // autoFocus on open) so the success/failure panel is the sole feedback for
    // this action and we don't render the contradictory pair from
    // a green "connected" banner alongside a red "укажите название" error.
    methods.clearErrors("name");
    const valid = await methods.trigger(["host", "port", "database", "username"]);
    if (!valid) return;
    const values = methods.getValues();
    setTestState({ status: "running" });
    try {
      const blankPassword = values.password === "";
      const formInput = {
        host: values.host,
        port: values.port,
        database: values.database,
        username: values.username,
        password: blankPassword ? undefined : values.password,
        sslMode: values.sslMode,
      };
      // In edit mode, blank password means "keep saved" — backend fills it
      // from the keychain. Otherwise the test would always fail with PG's
      // "invalid configuration" / auth-failed against a passwordless config.
      const result =
        formMode.type === "edit" && editingConnection && blankPassword
          ? await testConnectionForEdit(editingConnection.id, formInput)
          : await testConnection(formInput);
      setTestState({ status: result.ok ? "success" : "failure", result });
      if (result.ok) {
        // Inline success block is rendered at the bottom of the form body
        // (.q-modal-body is `overflow:auto`), so on small viewports it can
        // sit below the fold — the user clicks Test, sees no change, and
        // assumes nothing happened. Toast guarantees visible confirmation.
        const message = result.serverVersion
          ? t("toast.connection.test_succeeded_with_version", {
              ms: result.durationMs,
              version: shortServerVersion(result.serverVersion),
            })
          : t("toast.connection.test_succeeded", { ms: result.durationMs });
        toast.success(message);
      } else {
        toast.error(t("toast.connection.test_failed"));
      }
    } catch (err) {
      const message = localizeConnectionError(err, t);
      setTestState({
        status: "failure",
        result: { ok: false, durationMs: 0, error: message, serverVersion: null },
      });
      toast.error(message);
    }
  }, [methods, t, toast, formMode.type, editingConnection]);

  // #24 — fetch the databases reachable with the current credentials and feed
  // them to the Database field's <datalist>. Connects to a maintenance DB, so
  // it works even when the typed database name is wrong. Mirrors handleTest's
  // edit/blank-password branching.
  const handleBrowseDatabases = useCallback(async () => {
    const valid = await methods.trigger(["host", "port", "username"]);
    if (!valid) return;
    const values = methods.getValues();
    const blankPassword = values.password === "" || values.password === undefined;
    const input = {
      host: values.host,
      port: values.port,
      database: values.database,
      username: values.username,
      password: blankPassword ? undefined : values.password,
      sslMode: values.sslMode,
    };
    setLoadingDatabases(true);
    try {
      const names =
        formMode.type === "edit" && editingConnection && blankPassword
          ? await listDatabasesForEdit(editingConnection.id, input)
          : await listDatabases(input);
      setDatabaseOptions(names);
      if (names.length === 0) {
        toast.info(t("connection.form.databases.empty"));
      } else {
        toast.success(t("connection.form.databases.loaded", { n: names.length }));
      }
    } catch (err) {
      toast.error(localizeConnectionError(err, t));
    } finally {
      setLoadingDatabases(false);
    }
  }, [methods, t, toast, formMode.type, editingConnection]);

  // when the user just ran a successful test in the form, mirror
  // that result onto the persisted row so ConnectionDetails doesn't go from
  // "Connection successful" straight to "Never tested". Failure-after-save is
  // best-effort: we already toasted the save success and the next manual
  // test will overwrite the field.
  const persistTestResultIfRecent = async (id: string): Promise<Connection | null> => {
    if (testState.status !== "success") return null;
    try {
      return await connectionRecordTestResult(id, true);
    } catch {
      return null;
    }
  };

  const onSubmit = methods.handleSubmit(async (values) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (formMode.type === "edit" && editingConnection) {
        const passwordDirty = methods.formState.dirtyFields.password === true;
        const trimmedPassword = values.password ?? "";
        const passwordOp =
          passwordDirty && trimmedPassword.length > 0
            ? { kind: "set" as const, value: trimmedPassword }
            : passwordDirty && trimmedPassword.length === 0 && editingConnection.hasPassword
              ? { kind: "clear" as const }
              : { kind: "keep" as const };

        // Detect "config-affecting" changes — these invalidate any active pool
        // because the new pool would target a different DB or use different
        // credentials. Backend already evicts the pool, but the schema-browser
        // store still thinks it's connected; force a clean reset so the
        // sidebar drops to idle and the user explicitly reconnects.
        const configChanged =
          values.host !== editingConnection.host ||
          values.port !== editingConnection.port ||
          values.database !== editingConnection.database ||
          values.username !== editingConnection.username ||
          values.sslMode !== editingConnection.sslMode ||
          passwordOp.kind !== "keep";

        const updated = await updateConnection(editingConnection.id, {
          name: values.name,
          host: values.host,
          port: values.port,
          database: values.database,
          username: values.username,
          password: passwordOp,
          sslMode: values.sslMode,
          excludeFromHistory: values.excludeFromHistory,
          excludeFromRecentPlans: values.excludeFromRecentPlans,
          environment: values.environment,
          readOnly: values.readOnly,
          slowQueryWarning: values.slowQueryWarning,
          confirmDestructive: values.confirmDestructive,
        });
        const withTest = await persistTestResultIfRecent(updated.id);
        upsertLocal(withTest ?? updated);

        if (configChanged) {
          const schemaState = useSchema.getState();
          const isActive =
            (schemaState.connection.status === "connected" ||
              schemaState.connection.status === "error" ||
              schemaState.connection.status === "connecting") &&
            schemaState.connection.connId === editingConnection.id;
          if (isActive) {
            await schemaState.disconnect();
          }
        }

        toast.success(t("toast.connection.saved"));
        closeForm();
      } else {
        const created = await createConnection({
          name: values.name,
          host: values.host,
          port: values.port,
          database: values.database,
          username: values.username,
          password: values.password === "" ? undefined : values.password,
          sslMode: values.sslMode,
          excludeFromHistory: values.excludeFromHistory,
          excludeFromRecentPlans: values.excludeFromRecentPlans,
          environment: values.environment,
          readOnly: values.readOnly,
          slowQueryWarning: values.slowQueryWarning,
          confirmDestructive: values.confirmDestructive,
        });
        const withTest = await persistTestResultIfRecent(created.id);
        upsertLocal(withTest ?? created);
        // The user committed to this Instant DB — clear the orphan tracker
        // so a later abandon path can never delete a saved, in-use record.
        setPendingInstantDbId(null);
        toast.success(t("toast.connection.saved"));
        closeForm();
      }
    } catch (err) {
      toast.error(localizeConnectionError(err, t));
    } finally {
      setSubmitting(false);
    }
  });

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return; // Radix only ever calls with `false` here in our usage.
      if (methods.formState.isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      cancelAndCleanup();
    },
    [methods.formState.isDirty, cancelAndCleanup],
  );

  if (!isOpen) return null;

  // Connection params (host/port/database/username/password/sslMode) for an
  // Instant DB are server-generated and exist on Postgres exactly as issued.
  // Editing them in the form only desyncs the local connection record from
  // the real DB — and a user who edits then forgets the original creds is
  // locked out for the rest of the TTL. Lock those fields here, leaving the
  // Name field editable so the user can still relabel the row.
  const isInstantDbManaged = pendingInstantDbId !== null;

  const saveWithoutTesting = methods.watch("saveWithoutTesting");
  // Read formState during render so RHF subscribes the proxy and re-renders
  // (and recomputes saveEnabled) as dirtiness changes — including setValue-
  // driven fields like `environment` that mark dirty via { shouldDirty: true }.
  const { isDirty, dirtyFields } = methods.formState;
  // Connectivity fields (the same set as `configChanged` at submit time) keep
  // Save gated behind a successful test or the explicit "save without testing"
  // opt-in: editing them means the last test no longer reflects what we'd
  // persist. Use dirtyFields (not value compare) so coercion (port) and
  // edit-then-revert behave correctly.
  const connectivityDirty =
    dirtyFields.host === true ||
    dirtyFields.port === true ||
    dirtyFields.database === true ||
    dirtyFields.username === true ||
    dirtyFields.password === true ||
    dirtyFields.sslMode === true;
  // Non-connectivity settings (name, environment, the safety/history toggles)
  // don't affect reachability, so a dirty edit to those alone enables Save —
  // added as a THIRD enabler so the existing test-success / save-without-
  // testing paths (which don't require dirtiness, e.g. re-test then save with
  // no edits) keep working unchanged.
  const saveEnabled =
    !submitting &&
    (testState.status === "success" ||
      saveWithoutTesting === true ||
      (isDirty && !connectivityDirty));

  const title =
    formMode.type === "edit" ? t("connection.form.title.edit") : t("connection.form.title.create");
  const description =
    formMode.type === "edit"
      ? t("connection.form.description.edit")
      : t("connection.form.description.create");

  return (
    <>
      <Dialog
        open={isOpen && !showDiscardConfirm}
        onOpenChange={handleOpenChange}
        title={title}
        description={description}
        closeAriaLabel={t("connection.form.action.cancel")}
        footer={
          <>
            <button type="button" onClick={() => handleOpenChange(false)} className="btn btn-ghost">
              {t("connection.form.action.cancel")}
            </button>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                marginRight: "auto",
              }}
            >
              <button
                type="button"
                onClick={handleTest}
                disabled={testState.status === "running"}
                className="btn"
              >
                {testState.status === "running" ? (
                  <Loader2 size={14} className="q-spin" aria-hidden="true" />
                ) : null}
                {testState.status === "running"
                  ? t("connection.form.test.testing")
                  : t("connection.form.action.test")}
              </button>
              {/*
               * inline status badge next to the Test button so the
               * action's outcome is visible at the click site even when the
               * detailed inline block at the bottom of the form scrolls below
               * the modal fold and the auto-dismissed toast has expired.
               */}
              {testState.status === "success" ? (
                <span
                  data-testid="form-test-success-badge"
                  aria-live="polite"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    color: "var(--accent)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <CheckCircle2 size={12} aria-hidden="true" />
                  {t("connection.form.test.success")}
                </span>
              ) : null}
              {testState.status === "failure" ? (
                <span
                  data-testid="form-test-failure-badge"
                  aria-live="polite"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    color: "var(--danger-q)",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  <XCircle size={12} aria-hidden="true" />
                  {t("connection.form.test.failure")}
                </span>
              ) : null}
            </span>
            <button
              type="submit"
              form="connection-form"
              disabled={!saveEnabled}
              className={`btn ${testState.status === "success" ? "btn-accent pulse-once" : "btn-primary"}`}
            >
              {t("connection.form.action.save")}
            </button>
          </>
        }
      >
        <FormProvider {...methods}>
          <form
            id="connection-form"
            onSubmit={onSubmit}
            className="flex flex-col gap-[var(--space-3)]"
          >
            <Field
              label={t("connection.form.field.name")}
              name="name"
              required
              inputProps={{
                placeholder: t("connection.form.field.name.placeholder"),
                autoFocus: true,
              }}
            />
            {isInstantDbManaged ? (
              <p
                data-testid="instant-db-managed-notice"
                style={{
                  margin: 0,
                  padding: "6px 10px",
                  fontSize: 11,
                  color: "var(--ink-3)",
                  background: "var(--surface-2, rgba(99,102,241,0.08))",
                  border: "1px solid var(--accent, #6366f1)",
                  borderRadius: 4,
                }}
              >
                {t("connection.form.instant_db.managed_notice", {
                  defaultValue:
                    "Connection details are managed by Instant DB and cannot be changed. You can rename the row above.",
                })}
              </p>
            ) : null}
            <Field
              label={t("connection.form.field.host")}
              name="host"
              required
              inputProps={{
                placeholder: t("connection.form.field.host.placeholder"),
                readOnly: isInstantDbManaged,
              }}
            />
            <Field
              label={t("connection.form.field.port")}
              name="port"
              type="number"
              valueAsNumber
              inputProps={{
                placeholder: t("connection.form.field.port.placeholder"),
                readOnly: isInstantDbManaged,
              }}
            />
            <Field
              label={t("connection.form.field.database")}
              name="database"
              required
              inputProps={{
                placeholder: t("connection.form.field.database.placeholder"),
                readOnly: isInstantDbManaged,
                list: "connection-database-options",
              }}
            />
            {isInstantDbManaged ? null : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: -8 }}>
                <button
                  type="button"
                  onClick={() => void handleBrowseDatabases()}
                  disabled={loadingDatabases}
                  className="btn btn-ghost"
                  data-testid="browse-databases"
                  style={{ fontSize: 11 }}
                >
                  {loadingDatabases ? (
                    <Loader2 size={12} className="q-spin" aria-hidden="true" />
                  ) : null}
                  {loadingDatabases
                    ? t("connection.form.databases.loading")
                    : t("connection.form.action.browse_databases")}
                </button>
              </div>
            )}
            <datalist id="connection-database-options">
              {databaseOptions.map((db) => (
                <option key={db} value={db} />
              ))}
            </datalist>
            <Field
              label={t("connection.form.field.username")}
              name="username"
              required
              inputProps={{
                placeholder: t("connection.form.field.username.placeholder"),
                readOnly: isInstantDbManaged,
              }}
            />

            <PasswordField
              label={t("connection.form.field.password")}
              showLabel={t("connection.form.password.show")}
              hideLabel={t("connection.form.password.hide")}
              placeholder={t("connection.form.field.password.placeholder")}
              showPassword={showPassword}
              onToggle={() => setShowPassword((prev) => !prev)}
              readOnly={isInstantDbManaged}
            />

            <SslModeField
              label={t("connection.form.field.ssl_mode")}
              ariaLabel={t("connection.form.field.ssl_mode")}
              disabled={isInstantDbManaged}
            />

            {showSslWarning ? (
              <div role="alert" className="q-answer warn">
                <span style={{ marginTop: 1 }} aria-hidden="true">
                  ⚠
                </span>
                <span style={{ fontSize: 12, lineHeight: 1.4, color: "var(--ink-2)" }}>
                  {t("connection.form.warning.ssl_disable_remote")}
                </span>
              </div>
            ) : null}

            <EnvironmentField label={t("connection.form.field.environment")} />

            <label className="q-checkbox" data-testid="read-only-label">
              <input
                type="checkbox"
                data-testid="read-only-checkbox"
                aria-label={t("connection.form.read_only.label")}
                {...methods.register("readOnly")}
              />
              {t("connection.form.read_only.label")}
            </label>

            <label className="q-checkbox" data-testid="confirm-destructive-label">
              <input
                type="checkbox"
                data-testid="confirm-destructive-checkbox"
                aria-label={t("connection.form.confirm_destructive.label")}
                {...methods.register("confirmDestructive")}
              />
              {t("connection.form.confirm_destructive.label")}
            </label>

            <label className="q-checkbox" data-testid="slow-query-warning-label">
              <input
                type="checkbox"
                data-testid="slow-query-warning-checkbox"
                aria-label={t("connection.form.slow_query_warning.label")}
                {...methods.register("slowQueryWarning")}
              />
              {t("connection.form.slow_query_warning.label")}
            </label>

            <label className="q-checkbox" style={{ marginTop: 4 }}>
              <input type="checkbox" {...methods.register("saveWithoutTesting")} />
              {t("connection.form.action.save_without_testing")}
            </label>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label className="q-checkbox" data-testid="exclude-history-label">
                <input
                  type="checkbox"
                  data-testid="exclude-history-checkbox"
                  aria-label={t("connection.form.exclude_history.label")}
                  {...methods.register("excludeFromHistory")}
                />
                {t("connection.form.exclude_history.label")}
              </label>
              <p style={{ paddingLeft: 24, fontSize: 11, color: "var(--ink-4)", margin: 0 }}>
                {t("connection.form.exclude_history.help")}
              </p>
            </div>

            <SaveRecentPlansField />

            {testState.status === "success" ? (
              <output className="q-answer ok" data-testid="form-test-success">
                <CheckCircle2
                  size={16}
                  aria-hidden="true"
                  style={{ marginTop: 1, flexShrink: 0 }}
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span className="title">{t("connection.form.test.success")}</span>
                  <span className="sub">
                    {testState.result.serverVersion
                      ? t("connection.form.test.success_meta_with_version", {
                          ms: testState.result.durationMs,
                          version: shortServerVersion(testState.result.serverVersion),
                        })
                      : t("connection.form.test.success_meta", {
                          ms: testState.result.durationMs,
                        })}
                  </span>
                </div>
              </output>
            ) : null}

            {testState.status === "failure" ? (
              <div role="alert" className="q-answer err" data-testid="form-test-failure">
                <XCircle size={16} aria-hidden="true" style={{ marginTop: 1, flexShrink: 0 }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <span className="title">{t("connection.form.test.failure")}</span>
                  {testState.result.error ? (
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        fontFamily: "var(--font-mono-q)",
                        fontSize: 11.5,
                        color: "var(--ink-3)",
                      }}
                    >
                      {testState.result.error}
                    </pre>
                  ) : null}
                </div>
              </div>
            ) : null}
          </form>
        </FormProvider>
      </Dialog>

      <Dialog
        open={showDiscardConfirm}
        onOpenChange={(next) => {
          if (!next) setShowDiscardConfirm(false);
        }}
        title={t("connection.form.discard.title")}
        description={t("connection.form.discard.body")}
        size="sm"
        footer={
          <>
            <button
              type="button"
              onClick={() => setShowDiscardConfirm(false)}
              className="btn btn-ghost"
            >
              {t("connection.form.discard.cancel")}
            </button>
            <button
              type="button"
              data-testid="discard-confirm"
              onClick={() => {
                setShowDiscardConfirm(false);
                cancelAndCleanup();
              }}
              className="btn btn-danger"
            >
              {t("connection.form.discard.confirm")}
            </button>
          </>
        }
      >
        <p>{t("connection.form.discard.body")}</p>
      </Dialog>
    </>
  );
}

interface PasswordFieldProps {
  label: string;
  showLabel: string;
  hideLabel: string;
  placeholder: string;
  showPassword: boolean;
  onToggle: () => void;
  readOnly?: boolean;
}

function PasswordField({
  label,
  showLabel,
  hideLabel,
  placeholder,
  showPassword,
  onToggle,
  readOnly = false,
}: PasswordFieldProps) {
  return (
    <div className="relative">
      <Field
        label={label}
        name="password"
        type={showPassword ? "text" : "password"}
        inputProps={{ placeholder, autoComplete: "off", readOnly }}
      />
      <button
        type="button"
        aria-label={showPassword ? hideLabel : showLabel}
        onClick={onToggle}
        className="btn-icon"
        style={{ position: "absolute", right: 4, top: 24, width: 28, height: 28 }}
      >
        {showPassword ? (
          <EyeOff size={14} aria-hidden="true" />
        ) : (
          <Eye size={14} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

interface SslModeFieldProps {
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}

function SslModeField({ label, ariaLabel, disabled = false }: SslModeFieldProps) {
  const { t } = useTranslation();
  const ctx = useFormContext<FormValues>();
  const value = ctx?.watch("sslMode") ?? "prefer";

  return (
    <Field label={label} htmlFor="sslMode-trigger">
      <Select
        id="sslMode-trigger"
        value={value}
        onValueChange={(v) =>
          ctx?.setValue("sslMode", v as SslMode, {
            shouldDirty: true,
            shouldValidate: false,
          })
        }
        ariaLabel={ariaLabel}
        disabled={disabled}
        options={SSL_MODES.map((mode) => ({
          value: mode,
          label: t(`connection.form.field.ssl_mode.option.${mode}`, mode),
        }))}
      />
    </Field>
  );
}

interface EnvironmentFieldProps {
  label: string;
}

/**
 * Environment dropdown — renders the EnvironmentSelect inside a labelled
 * Field. Selecting `prod` is opinionated: it ALSO ticks `confirmDestructive`
 * and `slowQueryWarning` automatically (UI ergonomics; Rust default still
 * `local` / false). The 3 safety-guard checkboxes can be toggled
 * independently after that. We deliberately do NOT auto-enable `readOnly`
 * on prod: read-only would block DROP/TRUNCATE before the confirm-by-typing
 * modal could fire, breaking the documented prod safety contract
 * (prod + DROP TABLE → typing modal). Users who want read-only prod tick
 * the checkbox explicitly.
 */
/**
 * — controlled field bound to `excludeFromRecentPlans` with
 * inverted semantics: the visible label reads "Save EXPLAIN plans"
 * (affirmative), so checked = true means we DO save (excludeFromRecentPlans
 * = false). The form field name stays negative for backend symmetry with
 * `excludeFromHistory`. The input lives directly inside the <label> so the
 * Biome a11y rule (noLabelWithoutControl) sees the association statically.
 */
function SaveRecentPlansField(): JSX.Element {
  const { t } = useTranslation();
  const ctx = useFormContext<FormValues>();
  const exclude = ctx?.watch("excludeFromRecentPlans") ?? false;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label className="q-checkbox" data-testid="exclude-recent-plans-label">
        <input
          type="checkbox"
          data-testid="exclude-recent-plans-checkbox"
          aria-label={t("connection.form.exclude_from_recent_plans.label")}
          checked={!exclude}
          onChange={(e) => {
            ctx?.setValue("excludeFromRecentPlans", !e.currentTarget.checked, {
              shouldDirty: true,
              shouldValidate: false,
            });
          }}
        />
        {t("connection.form.exclude_from_recent_plans.label")}
      </label>
      <p style={{ paddingLeft: 24, fontSize: 11, color: "var(--ink-4)", margin: 0 }}>
        {t("connection.form.exclude_from_recent_plans.help")}
      </p>
    </div>
  );
}

function EnvironmentField({ label }: EnvironmentFieldProps) {
  const { t } = useTranslation();
  const ctx = useFormContext<FormValues>();
  const value = ctx?.watch("environment") ?? "local";

  return (
    <Field label={label} htmlFor="environment-trigger">
      <EnvironmentSelect
        ariaLabel={t("connection.form.field.environment")}
        value={value}
        onChange={(env) => {
          ctx?.setValue("environment", env, { shouldDirty: true, shouldValidate: false });
          if (env === "prod") {
            ctx?.setValue("confirmDestructive", true, {
              shouldDirty: true,
              shouldValidate: false,
            });
            ctx?.setValue("slowQueryWarning", true, {
              shouldDirty: true,
              shouldValidate: false,
            });
          }
        }}
      />
    </Field>
  );
}
