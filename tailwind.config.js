/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B1220",
        muted: "#64748B",
        subtle: "#94A3B8",
        line: "#E2E8F0",
        canvas: "#F8FAFC",
        brand: {
          DEFAULT: "#2563EB",
          dark: "#1D4ED8",
        },
        success: "#15803D",
        warning: "#B45309",
        error: "#B91C1C",
        info: "#1D4ED8",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
