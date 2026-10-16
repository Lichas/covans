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
        // Shared cool neutrals keep form controls and secondary panels aligned.
        stone: {
          50: '#f5f8ff', 100: '#eaf0fa', 200: '#d5e0f0',
          300: '#b7c8e0', 400: 'rgb(var(--neutral-muted) / <alpha-value>)', 500: '#617695',
          600: '#496080', 700: '#30496d', 800: '#1d3152',
          900: '#122342', 950: '#0b1730',
        },
        ink: '#244e99',
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
