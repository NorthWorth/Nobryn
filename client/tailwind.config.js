/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Nobryn brand palette: Bio Black + Synthetic Lime + Soft Chrome.
        ink: "#06110D",
        muted: "#647067",
        subtle: "#8E9892",
        line: "#D9E0DC",
        canvas: "#E8ECF1",
        brand: {
          DEFAULT: "#06110D",
          dark: "#0E2119",
          lime: "#C8FF00",
          chrome: "#E8ECF1",
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
