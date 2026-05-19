import type { Config } from "tailwindcss";

/**
 * ide99 Tailwind config.
 *
 * Tailwind v4 supports a CSS-first config (the `@import "tailwindcss";` in
 * globals.css), but we keep this JS config for theme.extend customization
 * so utilities like `bg-brand-500` resolve to our CSS variables. That way
 * a single `data-theme="dark"` toggle re-themes every Tailwind class
 * without any rebuild or class swap.
 *
 * Tokens come from src/styles/tokens.css + themes.css (see
 * docs/design/02-ui-system.md for the source of truth).
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "var(--brand-50)",
          100: "var(--brand-100)",
          200: "var(--brand-200)",
          300: "var(--brand-300)",
          400: "var(--brand-400)",
          500: "var(--brand-500)",
          600: "var(--brand-600)",
          700: "var(--brand-700)",
          800: "var(--brand-800)",
          900: "var(--brand-900)",
        },
        gray: {
          0: "var(--gray-0)",
          50: "var(--gray-50)",
          100: "var(--gray-100)",
          200: "var(--gray-200)",
          300: "var(--gray-300)",
          400: "var(--gray-400)",
          500: "var(--gray-500)",
          600: "var(--gray-600)",
          700: "var(--gray-700)",
          800: "var(--gray-800)",
          900: "var(--gray-900)",
          950: "var(--gray-950)",
        },
        success: {
          50: "var(--success-50)",
          500: "var(--success-500)",
          600: "var(--success-600)",
          700: "var(--success-700)",
        },
        warning: {
          50: "var(--warning-50)",
          500: "var(--warning-500)",
          600: "var(--warning-600)",
          700: "var(--warning-700)",
        },
        error: {
          50: "var(--error-50)",
          500: "var(--error-500)",
          600: "var(--error-600)",
          700: "var(--error-700)",
        },
        info: {
          50: "var(--info-50)",
          500: "var(--info-500)",
          600: "var(--info-600)",
          700: "var(--info-700)",
        },
        env: {
          local: "var(--env-local)",
          dev: "var(--env-dev)",
          stage: "var(--env-stage)",
          prod: "var(--env-prod)",
        },
        easy: {
          DEFAULT: "var(--easy-accent)",
          soft: "var(--easy-accent-soft)",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ['"Inter Display"', "Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "Consolas", "monospace"],
      },
      fontSize: {
        xs: ["11px", "14px"],
        sm: ["13px", "18px"],
        base: ["14px", "20px"],
        md: ["16px", "22px"],
        lg: ["18px", "24px"],
        xl: ["24px", "30px"],
        "2xl": ["32px", "38px"],
      },
      spacing: {
        px: "1px",
        0: "0",
        1: "var(--space-1)",
        2: "var(--space-2)",
        3: "var(--space-3)",
        4: "var(--space-4)",
        5: "var(--space-5)",
        6: "var(--space-6)",
        8: "var(--space-8)",
        10: "var(--space-10)",
        12: "var(--space-12)",
        16: "var(--space-16)",
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "9999px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-xl)",
      },
      zIndex: {
        base: "0",
        dropdown: "100",
        sticky: "200",
        modal: "300",
        popover: "400",
        tooltip: "500",
        toast: "600",
        loading: "9999",
      },
      transitionDuration: {
        instant: "0ms",
        fast: "100ms",
        DEFAULT: "200ms",
        slow: "300ms",
        slower: "500ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
        "in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
        spring: "cubic-bezier(0.5, 1.6, 0.6, 1)",
      },
    },
  },
} satisfies Config;
