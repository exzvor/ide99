// v1.0 GA — single-screen first-launch onboarding.
//
// Mode pick (Easy / Standard / Skip). Easy dispatches
// `ide99:tour:start` so the existing 8-step S33 tour runs; Standard
// and Skip land the user straight in ide99. Connection profile +
// sample-DB pickers were retired from this dialog and live as inline
// coach-marks in the empty connection list (`onboarding-coach-marks/`).

export { OnboardingWizard } from "./OnboardingWizard";
export { useOnboarding } from "./store";
export type { OnboardingStep, ConnectionProfile } from "./types";
