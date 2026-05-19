import type { JSX, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { CardData } from "./types";

interface Props<T> {
  state: CardData<T>;
  renderReady: (data: T) => ReactNode;
  onRetry?: () => void;
}

export function CardStateRouter<T>({ state, renderReady, onRetry }: Props<T>): JSX.Element {
  const { t } = useTranslation();
  switch (state.status) {
    case "idle":
    case "loading":
      return <div className="live-ops-shimmer">···</div>;
    case "ready":
      return <>{renderReady(state.data)}</>;
    case "unavailable":
      return (        <div className="live-ops-shimmer">
          <strong>{t("live_ops.error.unavailable", { extension: state.extension })}</strong>
          <pre style={{ marginTop: 8 }}>{state.installSql}</pre>
        </div>
);
    case "forbidden":
      return (        <div className="live-ops-shimmer">
          <strong>{t("live_ops.error.forbidden", { role: state.requiredRole })}</strong>
          <pre style={{ marginTop: 8 }}>
            {t("live_ops.error.forbidden_grant", { role: state.requiredRole })}
          </pre>
        </div>
);
    case "error":
      return (        <div className="live-ops-shimmer">
          <strong>{t("live_ops.error.query_failed", { message: state.message })}</strong>
          {onRetry && (            <button type="button" onClick={onRetry} style={{ marginTop: 8 }}>
              {t("live_ops.error.retry")}
            </button>
)}
        </div>
);
  }
}
