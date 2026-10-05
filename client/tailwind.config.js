/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      // Mobile-first breakpoints conforming to NR-017 & NR-018
      'xs': '360px',  // Phone portrait base (360x800)
      'sm': '640px',
      'md': '768px',  // Tablet portrait / Phone landscape (768x1024 / 800x360)
      'lg': '1024px', // Tablet landscape (1024x768)
      'xl': '1280px', // Desktop base (1280x720)
      '2xl': '1536px',
    },
    extend: {},
  },
  plugins: [],
};
