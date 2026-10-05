/** @type {import('tailwindcss').Config} */

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],

  darkMode: 'class',

  theme: {
    extend: {
      colors: {
        apple: {
          bg: '#f5f5f7',
          card: '#ffffff',
          border: '#e5e5e7',
          text: '#1d1d1f',
          muted: '#86868b',
          tint: '#ecfdf5',
        },

        /* Emerald accent — used via `forest-*` across the app */
        forest: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },

        /* Neutral grays (Apple secondary surfaces) */
        olive: {
          50: '#f5f5f7',
          100: '#e5e5e7',
          200: '#d2d2d7',
          300: '#aeaeb2',
          400: '#86868b',
          500: '#6e6e73',
          600: '#48484a',
          700: '#3a3a3c',
          800: '#2c2c2e',
          900: '#1d1d1f',
          950: '#141416',
        },

        mint: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
        },

        cocoa: {
          50: '#faf6f1',
          100: '#f0e6d8',
          200: '#e0cbb0',
          300: '#c9a882',
          400: '#b0895c',
          500: '#8b5e34',
          600: '#734c2a',
          700: '#5c3d24',
          800: '#46301d',
          900: '#2c1e14',
        },

        obsidian: {
          50: '#f5f5f7',
          100: '#e5e5e7',
          200: '#d2d2d7',
          300: '#aeaeb2',
          400: '#86868b',
          500: '#6e6e73',
          600: '#48484a',
          700: '#3a3a3c',
          800: '#2c2c2e',
          850: '#242426',
          900: '#1d1d1f',
          950: '#141416',
        },
      },

      fontFamily: {
        sans: [
          '"Noto Sans"',
          '"Noto Sans Khmer UI"',
          '"Noto Sans Khmer"',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
      },

      boxShadow: {
        apple: '0 1px 2px rgb(0 0 0 / 0.04)',
        'apple-md': '0 4px 24px rgb(0 0 0 / 0.06)',
      },
    },
  },

  plugins: [],
}
