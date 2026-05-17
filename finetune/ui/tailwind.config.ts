import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        soft: {
          border: "#ececec",
          surface: "#fafafa",
          hover: "#f4f4f5",
        },
      },
    },
  },
  plugins: [],
};
export default config;
