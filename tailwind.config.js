/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/**/*.{ts,tsx,html}'],
  darkMode: 'class',
  theme: {
    extend: {
      borderRadius: {
        bubble: '18px',
      },
      colors: {
        // Neutral gray scale shared with the CSS tokens in index.css. 400 follows the
        // themed muted token so light and dark stay in sync.
        stone: {
          50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7',
          300: '#d4d4d8', 400: 'rgb(var(--neutral-muted) / <alpha-value>)',
          500: '#71717a', 600: '#52525b', 700: '#3f3f46', 800: '#27272a',
          900: '#18181b', 950: '#09090b',
        },
        ink: '#18181b',
        paper: '#fafafa',
        bubbleBot: '#f4f4f5',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        blink: 'blink 1s step-start infinite',
        fadeIn: 'fadeIn 120ms ease-out',
      },
    },
  },
  plugins: [],
}
