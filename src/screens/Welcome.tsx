import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { ThemeSwitcher } from "../components/ThemeSwitcher";
import { Mesh } from "../components/quiet/Mesh";
import { Particles } from "../components/quiet/Particles";
import { Titlebar } from "../components/quiet/Titlebar";
import { Wordmark } from "../components/quiet/Wordmark";
import { EmptyState } from "../features/connections/EmptyState";

/**
 * Welcome — first-run screen (no saved connections).
 * Layout:
 * .titlebar (macOS-style)
 * .mesh.subtle background
 * .content (flex column, centered):
 * wordmark [ide99] · headline · subhead · CTA · hint · uri input
 * TopRight: language + theme toggles
 */
export default function Welcome() {
  const { t } = useTranslation();
  return (
    <main aria-labelledby="welcome-heading" className="app-frame">
      <Titlebar />
      <Mesh variant="subtle" />
      <Particles />
      <div
        style={{
          flex: 1,
          position: "relative",
          minHeight: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 40px",
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            display: "flex",
            gap: 4,
            zIndex: 5,
          }}
        >
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            maxWidth: 480,
            width: "100%",
          }}
        >
          <Wordmark size="lg" />
          <h1
            id="welcome-heading"
            className="q-welcome-sub"
            style={{
              marginTop: 14,
              marginBottom: 0,
              fontWeight: "inherit",
              fontSize: "inherit",
              lineHeight: "inherit",
            }}
          >
            {t("welcome.tagline")}
          </h1>

          <div style={{ height: 22 }} />
          <EmptyState />
        </div>
      </div>
    </main>
  );
}
