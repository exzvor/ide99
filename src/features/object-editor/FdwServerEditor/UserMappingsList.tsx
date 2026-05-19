// — per-FDW-server user-mapping list. Each card carries a role
// name plus a nested OptionsList for the per-mapping options bag.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";

import type { UserMappingForm } from "../ddl/types";
import { OptionsList } from "./OptionsList";

let counter = 0;
const newId = (): string => `s25-um-${Date.now()}-${++counter}`;

export interface UserMappingsListProps {
  mappings: UserMappingForm[];
  onChange: (next: UserMappingForm[]) => void;
}

export function UserMappingsList({ mappings, onChange }: UserMappingsListProps): JSX.Element {
  const { t } = useTranslation();
  return (    <fieldset
      data-testid="fdw-mappings-fieldset"
      style={{
        border: "1px solid var(--border-strong-q)",
        borderRadius: "var(--r-md)",
        padding: 12,
        margin: 0,
        display: "grid",
        gap: 12,
      }}
    >
      <legend style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ink-3)", padding: "0 6px" }}>
        {t("object_editor.fdw_server.user_mappings_section")}
      </legend>
      {mappings.map((m, i) => (        <div
          key={m.id}
          data-testid={`fdw-mapping-${i}`}
          style={{
            border: "1px solid var(--hairline)",
            borderRadius: "var(--r-md)",
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div className="q-field">
            <label htmlFor={`fdw-mapping-${i}-role-input`}>
              {t("object_editor.fdw_server.mapping_role")}
            </label>
            <input
              id={`fdw-mapping-${i}-role-input`}
              className="q-input mono"
              value={m.roleName}
              data-testid={`fdw-mapping-${i}-role`}
              onChange={(e) =>
                onChange(                  mappings.map((it) => (it.id === m.id ? { ...it, roleName: e.target.value } : it)),
)
              }
            />
          </div>
          <OptionsList
            options={m.options}
            onChange={(opts) =>
              onChange(mappings.map((it) => (it.id === m.id ? { ...it, options: opts } : it)))
            }
            labelText={t("object_editor.fdw_server.options_section")}
            addLabel={t("object_editor.fdw_server.add_option")}
            testidPrefix={`fdw-mapping-${i}-options`}
          />
          <button
            type="button"
            className="btn btn-danger"
            data-testid={`fdw-mapping-${i}-remove`}
            onClick={() => onChange(mappings.filter((it) => it.id !== m.id))}
            style={{ alignSelf: "flex-start" }}
          >
            Remove mapping
          </button>
        </div>
))}
      <button
        type="button"
        className="btn"
        data-testid="fdw-mappings-add"
        onClick={() => onChange([...mappings, { id: newId(), roleName: "", options: [] }])}
        style={{ alignSelf: "start" }}
      >
        + {t("object_editor.fdw_server.add_mapping")}
      </button>
    </fieldset>
);
}
