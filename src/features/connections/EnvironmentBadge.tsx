import { useTranslation } from "react-i18next";
import type { Environment } from "../../lib/tauri";

interface Props {
  environment: Environment;
  className?: string;
}

/**
 * — 8px round dot tinted per environment. Used in:
 * - ConnectionList rows
 * - ConnectionForm dropdown trigger + options
 * - Result-grid prod tint (Task 21)
 */
export function EnvironmentBadge({ environment, className }: Props) {
  const { t } = useTranslation();
  return (    <span
      className={`env-badge ${environment}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={t(`env.label.${environment}`)}
    />
);
}
