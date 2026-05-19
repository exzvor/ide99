import type { JSX } from "react";

interface MeshProps {
  variant?: "subtle" | "present" | "off";
}

/**
 * Tinted multi-blob background. Aesthetic only — z-index sits below content.
 * Tinted with brand-cyan, indigo, and pink; drifts on a 38–54s cycle.
 */
export function Mesh({ variant = "subtle" }: MeshProps): JSX.Element {
  return (
    <div className={`q-mesh ${variant}`} aria-hidden="true">
      <i />
    </div>
  );
}
