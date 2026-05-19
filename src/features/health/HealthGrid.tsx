import type { JSX, ReactNode } from "react";

interface HealthGridProps {
  children: ReactNode;
}

/**
 * — CSS Grid auto-fit responsive container (1 / 2 / 3 cols
 * based on viewport width). See spec §7.4.
 */
export function HealthGrid({ children }: HealthGridProps): JSX.Element {
  return (
    <div
      data-testid="health-grid"
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
      }}
    >
      {children}
    </div>
  );
}
