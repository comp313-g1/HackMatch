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
    extend: {
      colors: {
        cream: {
          DEFAULT: '#F7F3E9',
          50: '#FBF9F4',
          100: '#F3EDE0',
          200: '#E8DFD0',
        },
        forest: {
          DEFAULT: '#1B4332',
          50: '#E8F0EC',
          100: '#D1E1D9',
          200: '#A3C3B3',
          600: '#2D6A4F',
          700: '#1B4332',
          800: '#143328',
          900: '#0F241C',
        },
        ink: {
          DEFAULT: '#1A1F1C',
          muted: '#5C6660',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        sans: ['"Source Sans 3"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
