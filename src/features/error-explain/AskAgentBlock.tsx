/**
 * — fallback block when the error isn't in the mapping table.
 *
 * Shows: explanatory text + Copy-to-clipboard for the error context (paste
 * into Claude Code / Cursor connected via the ide99 MCP server, see
 *). No network calls — purely user-driven copy.
 */

import { type JSX, useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "../../components/Toast";
import { buildAgentContext } from "./lookup";

export interface AskAgentBlockProps {
  sqlstate?: string | null;
  message: string;
  sql?: string | null;
}

export function AskAgentBlock({ sqlstate, message, sql }: AskAgentBlockProps): JSX.Element {
  const { t } = useTranslation();
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      const text = buildAgentContext({ sqlstate, message, sql });
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="error-explain-ask-agent">
      <p>{t("errorExplain.askAgent.headline")}</p>
      <button type="button" onClick={onCopy} data-testid="error-explain-copy-context">
        {copied ? t("errorExplain.askAgent.copied") : t("errorExplain.askAgent.copy")}
      </button>
    </div>
  );
}
