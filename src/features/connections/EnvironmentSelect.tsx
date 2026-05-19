import * as Select from "@radix-ui/react-select";
import { useTranslation } from "react-i18next";
import type { Environment } from "../../lib/tauri";
import { EnvironmentBadge } from "./EnvironmentBadge";

interface Props {
  value: Environment;
  onChange: (env: Environment) => void;
  ariaLabel?: string;
}

const ENVIRONMENTS: Environment[] = ["local", "dev", "stage", "prod"];

/**
 * — Radix Select dropdown for picking a connection environment.
 * Shows a coloured badge in both the trigger and each option for fast
 * visual recognition.
 */
export function EnvironmentSelect({ value, onChange, ariaLabel }: Props) {
  const { t } = useTranslation();
  return (    <Select.Root value={value} onValueChange={(v) => onChange(v as Environment)}>
      <Select.Trigger className="env-select-trigger" aria-label={ariaLabel}>
        <EnvironmentBadge environment={value} />
        <Select.Value />
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="env-select-content">
          <Select.Viewport>
            {ENVIRONMENTS.map((env) => (              <Select.Item key={env} value={env} className="env-select-item">
                <EnvironmentBadge environment={env} />
                <Select.ItemText>{t(`env.label.${env}`)}</Select.ItemText>
              </Select.Item>
))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
);
}
