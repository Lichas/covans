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
        ink: '#171717',
        paper: '#f5f5f4',
        bubbleBot: '#f0f0ee',
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
