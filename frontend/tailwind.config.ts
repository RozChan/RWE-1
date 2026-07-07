import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f4f7fb",
        ink: "#17223b",
        muted: "#71809a",
        brand: "#2468f2",
      },
      boxShadow: {
        panel: "0 6px 24px rgba(35, 55, 95, .08)",
        float: "0 16px 45px rgba(25, 48, 98, .14)",
      },
    },
  },
  plugins: [],
} satisfies Config;
