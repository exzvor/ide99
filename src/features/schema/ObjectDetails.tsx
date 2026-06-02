import { Loader2 } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { localizeConnectionError } from "../../lib/errors";
import {
  type ColumnInfo,
  type ForeignKeyInfo,
  type FunctionDefinition,
  type IndexInfo,
  type MatviewDefinition,
  type ProcedureDefinition,
  type ViewInfo,
  schemaGetFunctionDefinition,
  schemaGetMatviewDefinition,
  schemaGetProcedureDefinition,
  schemaListColumns,
  schemaListForeignKeys,
  schemaListIndexes,
  schemaListViews,
} from "../../lib/tauri";
import { type NodeKey, parseRoutineKey, useSchema } from "./store";

/**
 * Main-area panel for selected tree node (spec §5.4 / §7.4).
 *
 * - For `table:<schema>/<name>` nodes: renders three tabs (Columns / Indexes /
 * Foreign Keys); each tab fetches lazily on first activation and caches the
 * result in component-local state.
 * - For `view:<schema>/<name>` nodes: renders a single Definition tab; the
 * view definition is re-fetched via `schemaListViews()` (decoupled from the
 * schema-tree store cache so this component can land independently of
 * 's store implementation).
 * - For `matview:<schema>/<name>` nodes: renders a single Definition tab backed
 * by `schemaGetMatviewDefinition()`, with a note when the matview is
 * unpopulated (created/refreshed WITH NO DATA).
 * - For `null`, schemas, or group nodes: renders a no-selection placeholder.
 */

type TableTab = "columns" | "indexes" | "foreignKeys";

interface ParsedTable {
  kind: "table";
  schema: string;
  name: string;
}

interface ParsedView {
  kind: "view";
  schema: string;
  name: string;
}

interface ParsedMatview {
  kind: "matview";
  schema: string;
  name: string;
}

interface ParsedRoutine {
  kind: "function" | "procedure";
  schema: string;
  name: string;
  args: string;
}

type ParsedNode =
  | ParsedTable
  | ParsedView
  | ParsedMatview
  | ParsedRoutine
  | { kind: "placeholder" };

function parseNode(node: NodeKey | null): ParsedNode {
  if (node === null) return { kind: "placeholder" };
  if (node.startsWith("table:")) {
    const rest = node.slice("table:".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return { kind: "placeholder" };
    return { kind: "table", schema: rest.slice(0, slash), name: rest.slice(slash + 1) };
  }
  if (node.startsWith("view:")) {
    const rest = node.slice("view:".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return { kind: "placeholder" };
    return { kind: "view", schema: rest.slice(0, slash), name: rest.slice(slash + 1) };
  }
  if (node.startsWith("matview:")) {
    const rest = node.slice("matview:".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return { kind: "placeholder" };
    return { kind: "matview", schema: rest.slice(0, slash), name: rest.slice(slash + 1) };
  }
  const routine = parseRoutineKey(node);
  if (routine) {
    return routine;
  }
  return { kind: "placeholder" };
}

export function ObjectDetails({ node }: { node: NodeKey | null }): JSX.Element {
  const { t } = useTranslation();
  const connection = useSchema((s) => s.connection);

  const parsed = parseNode(node);

  if (parsed.kind === "placeholder") {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <p style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{t("object_details.no_selection")}</p>
      </div>
    );
  }

  if (connection.status !== "connected") {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <p style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{t("object_details.no_selection")}</p>
      </div>
    );
  }

  if (parsed.kind === "table") {
    return (
      <TableDetails
        connId={connection.connId}
        schema={parsed.schema}
        name={parsed.name}
        // Re-mount when node changes so per-section caches reset.
        key={`table:${parsed.schema}/${parsed.name}`}
      />
    );
  }

  if (parsed.kind === "matview") {
    return (
      <MatviewDetails
        connId={connection.connId}
        schema={parsed.schema}
        name={parsed.name}
        key={`matview:${parsed.schema}/${parsed.name}`}
      />
    );
  }

  if (parsed.kind === "function" || parsed.kind === "procedure") {
    return (
      <RoutineDetails
        kind={parsed.kind}
        connId={connection.connId}
        schema={parsed.schema}
        name={parsed.name}
        args={parsed.args}
        key={`${parsed.kind}:${parsed.schema}/${parsed.name}#${parsed.args}`}
      />
    );
  }

  return (
    <ViewDetails
      connId={connection.connId}
      schema={parsed.schema}
      name={parsed.name}
      key={`view:${parsed.schema}/${parsed.name}`}
    />
  );
}

interface FetchState<T> {
  loading: boolean;
  data: T | null;
  error: string | null;
}

const initialFetch = <T,>(): FetchState<T> => ({ loading: false, data: null, error: null });

function TableDetails({
  connId,
  schema,
  name,
}: {
  connId: string;
  schema: string;
  name: string;
}): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState<TableTab>("columns");

  const [columns, setColumns] = useState<FetchState<ColumnInfo[]>>(initialFetch);
  const [indexes, setIndexes] = useState<FetchState<IndexInfo[]>>(initialFetch);
  const [foreignKeys, setForeignKeys] = useState<FetchState<ForeignKeyInfo[]>>(initialFetch);

  // Guard against state updates after unmount / target change. Each load*
  // closure captures the ref by reference; on unmount we flip it to false so
  // any late-arriving fetch result is dropped silently (no React warning, no
  // stale data flash).
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadColumns = useCallback(() => {
    setColumns({ loading: true, data: null, error: null });
    schemaListColumns(connId, schema, name)
      .then((data) => {
        if (!aliveRef.current) return;
        setColumns({ loading: false, data, error: null });
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        const message = localizeConnectionError(err, t);
        setColumns({ loading: false, data: null, error: message });
        toast.error(message);
      });
  }, [connId, schema, name, toast, t]);

  const loadIndexes = useCallback(() => {
    setIndexes({ loading: true, data: null, error: null });
    schemaListIndexes(connId, schema, name)
      .then((data) => {
        if (!aliveRef.current) return;
        setIndexes({ loading: false, data, error: null });
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        const message = localizeConnectionError(err, t);
        setIndexes({ loading: false, data: null, error: message });
        toast.error(message);
      });
  }, [connId, schema, name, toast, t]);

  const loadForeignKeys = useCallback(() => {
    setForeignKeys({ loading: true, data: null, error: null });
    schemaListForeignKeys(connId, schema, name)
      .then((data) => {
        if (!aliveRef.current) return;
        setForeignKeys({ loading: false, data, error: null });
      })
      .catch((err: unknown) => {
        if (!aliveRef.current) return;
        const message = localizeConnectionError(err, t);
        setForeignKeys({ loading: false, data: null, error: message });
        toast.error(message);
      });
  }, [connId, schema, name, toast, t]);

  // Fetch columns on mount (default tab).
  useEffect(() => {
    loadColumns();
  }, [loadColumns]);

  // On tab switch, fetch if not yet loaded.
  useEffect(() => {
    if (tab === "indexes" && indexes.data === null && !indexes.loading && indexes.error === null) {
      loadIndexes();
    }
    if (
      tab === "foreignKeys" &&
      foreignKeys.data === null &&
      !foreignKeys.loading &&
      foreignKeys.error === null
    ) {
      loadForeignKeys();
    }
  }, [tab, indexes, foreignKeys, loadIndexes, loadForeignKeys]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div role="tablist" aria-label={t("object_details.section.columns")} className="q-subtabbar">
        <TabButton
          active={tab === "columns"}
          onClick={() => setTab("columns")}
          controls="panel-columns"
          id="tab-columns"
        >
          {t("object_details.section.columns")}
        </TabButton>
        <TabButton
          active={tab === "indexes"}
          onClick={() => setTab("indexes")}
          controls="panel-indexes"
          id="tab-indexes"
        >
          {t("object_details.section.indexes")}
        </TabButton>
        <TabButton
          active={tab === "foreignKeys"}
          onClick={() => setTab("foreignKeys")}
          controls="panel-fks"
          id="tab-fks"
        >
          {t("object_details.section.foreign_keys")}
        </TabButton>
      </div>

      <div className="q-scroll" style={{ flex: 1, overflow: "auto", padding: 18, minHeight: 0 }}>
        {tab === "columns" ? (
          <div role="tabpanel" id="panel-columns" aria-labelledby="tab-columns">
            <ColumnsPanel state={columns} onRetry={loadColumns} />
          </div>
        ) : null}
        {tab === "indexes" ? (
          <div role="tabpanel" id="panel-indexes" aria-labelledby="tab-indexes">
            <IndexesPanel state={indexes} onRetry={loadIndexes} />
          </div>
        ) : null}
        {tab === "foreignKeys" ? (
          <div role="tabpanel" id="panel-fks" aria-labelledby="tab-fks">
            <ForeignKeysPanel state={foreignKeys} onRetry={loadForeignKeys} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ViewDetails({
  connId,
  schema,
  name,
}: {
  connId: string;
  schema: string;
  name: string;
}): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<FetchState<ViewInfo>>(initialFetch);

  const load = useCallback(() => {
    setState({ loading: true, data: null, error: null });
    schemaListViews(connId, schema)
      .then((views) => {
        const found = views.find((v) => v.name === name);
        if (!found) {
          const message = t("object_details.empty");
          setState({ loading: false, data: null, error: message });
          return;
        }
        setState({ loading: false, data: found, error: null });
      })
      .catch((err: unknown) => {
        const message = localizeConnectionError(err, t);
        setState({ loading: false, data: null, error: message });
        toast.error(message);
      });
  }, [connId, schema, name, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        role="tablist"
        aria-label={t("object_details.section.definition")}
        className="q-subtabbar"
      >
        <TabButton active onClick={() => {}} controls="panel-definition" id="tab-definition">
          {t("object_details.section.definition")}
        </TabButton>
      </div>
      <div className="q-scroll" style={{ flex: 1, overflow: "auto", padding: 18, minHeight: 0 }}>
        <div role="tabpanel" id="panel-definition" aria-labelledby="tab-definition">
          {state.loading ? <LoadingRow /> : null}
          {state.error ? <ErrorRow message={state.error} onRetry={load} /> : null}
          {state.data ? (
            <pre
              style={{
                overflow: "auto",
                background: "var(--bg-sunken)",
                padding: 12,
                borderRadius: 8,
                margin: 0,
                fontFamily: "var(--font-mono-q)",
                fontSize: 11.5,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
              }}
            >
              <code>{state.data.definition}</code>
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MatviewDetails({
  connId,
  schema,
  name,
}: {
  connId: string;
  schema: string;
  name: string;
}): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<FetchState<MatviewDefinition>>(initialFetch);

  const load = useCallback(() => {
    setState({ loading: true, data: null, error: null });
    schemaGetMatviewDefinition(connId, schema, name)
      .then((def) => {
        setState({ loading: false, data: def, error: null });
      })
      .catch((err: unknown) => {
        const message = localizeConnectionError(err, t);
        setState({ loading: false, data: null, error: message });
        toast.error(message);
      });
  }, [connId, schema, name, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        role="tablist"
        aria-label={t("object_details.section.definition")}
        className="q-subtabbar"
      >
        <TabButton active onClick={() => {}} controls="panel-definition" id="tab-definition">
          {t("object_details.section.definition")}
        </TabButton>
      </div>
      <div className="q-scroll" style={{ flex: 1, overflow: "auto", padding: 18, minHeight: 0 }}>
        <div role="tabpanel" id="panel-definition" aria-labelledby="tab-definition">
          {state.loading ? <LoadingRow /> : null}
          {state.error ? <ErrorRow message={state.error} onRetry={load} /> : null}
          {state.data ? (
            <>
              {state.data.populated ? null : (
                <p
                  data-testid="matview-unpopulated"
                  style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--warn-q, #b8860b)" }}
                >
                  {t("object_details.matview.unpopulated")}
                </p>
              )}
              <pre
                style={{
                  overflow: "auto",
                  background: "var(--bg-sunken)",
                  padding: 12,
                  borderRadius: 8,
                  margin: 0,
                  fontFamily: "var(--font-mono-q)",
                  fontSize: 11.5,
                  color: "var(--ink-2)",
                  whiteSpace: "pre-wrap",
                }}
              >
                <code>{state.data.body}</code>
              </pre>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RoutineDetails({
  kind,
  connId,
  schema,
  name,
  args,
}: {
  kind: "function" | "procedure";
  connId: string;
  schema: string;
  name: string;
  args: string;
}): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] =
    useState<FetchState<FunctionDefinition | ProcedureDefinition>>(initialFetch);

  const load = useCallback(() => {
    setState({ loading: true, data: null, error: null });
    const fetchDef =
      kind === "function"
        ? schemaGetFunctionDefinition(connId, schema, name, args)
        : schemaGetProcedureDefinition(connId, schema, name, args);
    fetchDef
      .then((def) => {
        setState({ loading: false, data: def, error: null });
      })
      .catch((err: unknown) => {
        const message = localizeConnectionError(err, t);
        setState({ loading: false, data: null, error: message });
        toast.error(message);
      });
  }, [kind, connId, schema, name, args, t, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        role="tablist"
        aria-label={t("object_details.section.definition")}
        className="q-subtabbar"
      >
        <TabButton active onClick={() => {}} controls="panel-definition" id="tab-definition">
          {t("object_details.section.definition")}
        </TabButton>
      </div>
      <div className="q-scroll" style={{ flex: 1, overflow: "auto", padding: 18, minHeight: 0 }}>
        <div role="tabpanel" id="panel-definition" aria-labelledby="tab-definition">
          {state.loading ? <LoadingRow /> : null}
          {state.error ? <ErrorRow message={state.error} onRetry={load} /> : null}
          {state.data ? (
            <pre
              style={{
                overflow: "auto",
                background: "var(--bg-sunken)",
                padding: 12,
                borderRadius: 8,
                margin: 0,
                fontFamily: "var(--font-mono-q)",
                fontSize: 11.5,
                color: "var(--ink-2)",
                whiteSpace: "pre-wrap",
              }}
            >
              <code>{`-- ${state.data.name}(${args})  ·  language: ${state.data.language}\n\n${state.data.body}`}</code>
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  controls,
  id,
  children,
}: {
  active: boolean;
  onClick: () => void;
  controls: string;
  id: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`q-subtab ${active ? "active" : ""}`}
    >
      {children}
    </button>
  );
}

function LoadingRow(): JSX.Element {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
        color: "var(--ink-4)",
      }}
    >
      <Loader2 size={14} className="q-spin" aria-hidden="true" />
      <span>{t("schema.connecting")}</span>
    </div>
  );
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
      <span style={{ color: "var(--danger-q)" }}>{message}</span>
      <button type="button" onClick={onRetry} className="btn btn-sm">
        {t("schema.refresh")}
      </button>
    </div>
  );
}

function ColumnsPanel({
  state,
  onRetry,
}: {
  state: FetchState<ColumnInfo[]>;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (state.loading) return <LoadingRow />;
  if (state.error) return <ErrorRow message={state.error} onRetry={onRetry} />;
  if (!state.data || state.data.length === 0) {
    return <p style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{t("object_details.empty")}</p>;
  }
  return (
    <table className="q-grid" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th>{t("object_details.column.name")}</th>
          <th>{t("object_details.column.type")}</th>
          <th>{t("object_details.column.nullable")}</th>
          <th>{t("object_details.column.default")}</th>
          <th>{t("object_details.column.comment")}</th>
        </tr>
      </thead>
      <tbody>
        {state.data.map((c) => (
          <tr key={c.ordinal}>
            <td>{c.name}</td>
            <td>{c.dataType}</td>
            <td>{c.nullable ? "✓" : ""}</td>
            <td>{c.default ?? ""}</td>
            <td className="json">{c.comment ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IndexesPanel({
  state,
  onRetry,
}: {
  state: FetchState<IndexInfo[]>;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (state.loading) return <LoadingRow />;
  if (state.error) return <ErrorRow message={state.error} onRetry={onRetry} />;
  if (!state.data || state.data.length === 0) {
    return <p style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{t("object_details.empty")}</p>;
  }
  return (
    <ul
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        listStyle: "none",
        padding: 0,
        margin: 0,
      }}
    >
      {state.data.map((idx) => (
        <li
          key={idx.name}
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-q)",
            borderRadius: 10,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600, color: "var(--ink)", fontSize: 12.5 }}>
              {idx.name}
            </span>
            <span className="q-pill" style={{ fontSize: 10, padding: "1px 7px" }}>
              {idx.method}
            </span>
            {idx.isPrimary ? (
              <span className="q-pill ok" style={{ fontSize: 10, padding: "1px 7px" }}>
                PK
              </span>
            ) : null}
            {idx.isUnique ? (
              <span
                className="q-pill"
                style={{
                  fontSize: 10,
                  padding: "1px 7px",
                  background: "rgba(167,139,250,0.14)",
                  color: "#7c3aed",
                }}
              >
                UNIQUE
              </span>
            ) : null}
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono-q)",
              fontSize: 11.5,
              color: "var(--ink-3)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <code>{idx.definition}</code>
          </pre>
        </li>
      ))}
    </ul>
  );
}

function ForeignKeysPanel({
  state,
  onRetry,
}: {
  state: FetchState<ForeignKeyInfo[]>;
  onRetry: () => void;
}): JSX.Element {
  const { t } = useTranslation();
  if (state.loading) return <LoadingRow />;
  if (state.error) return <ErrorRow message={state.error} onRetry={onRetry} />;
  if (!state.data || state.data.length === 0) {
    return <p style={{ fontSize: 12.5, color: "var(--ink-4)" }}>{t("object_details.empty")}</p>;
  }
  return (
    <ul
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        listStyle: "none",
        padding: 0,
        margin: 0,
      }}
    >
      {state.data.map((fk) => (
        <li
          key={fk.name}
          style={{
            background: "var(--bg-elev)",
            border: "1px solid var(--border-q)",
            borderRadius: 10,
            padding: "12px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontWeight: 600, color: "var(--ink)", fontSize: 12.5 }}>
              {fk.name}
            </span>
            <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
              → {fk.referencedSchema}.{fk.referencedTable}
            </span>
          </div>
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono-q)",
              fontSize: 11.5,
              color: "var(--ink-3)",
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <code>{fk.definition}</code>
          </pre>
        </li>
      ))}
    </ul>
  );
}
