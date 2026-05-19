// Onboarding wizard DTOs.
//
// v1.0 GA — single-step "welcome" wizard. The 4-step
// (welcome → connection → sample-db → tour-handoff) flow was creating
// ~13 interrupt screens before the user could touch ide99 (telemetry
// modal + 4-step wizard + 8-step tour). Connection profiles + sample-
// DB now live inline in the empty connection list as contextual coach
// marks instead.

export type OnboardingStep = "welcome";

export type ConnectionProfile =
  | "local"
  | "supabase"
  | "neon"
  | "railway"
  | "rds"
  | "spg99"
  | "custom"
  | "skip";

export type WizardState = {
  step: OnboardingStep;
  mode: "easy" | "standard" | null;
};
