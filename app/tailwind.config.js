/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        'shadow': {
          900: '#0a0a0f',
          800: '#12121a',
          700: '#1a1a25',
          600: '#252530',
          500: '#35354a',
        },
        'accent': {
          purple: '#8b5cf6',
          blue: '#3b82f6',
          green: '#10b981',
          red: '#ef4444',
        }
      },
      keyframes: {
        stackReveal1: {
          '0%, 100%': { opacity: '0', transform: 'translateY(10px)' },
          '20%, 80%': { opacity: '0.4', transform: 'translateY(0)' },
        },
        stackReveal2: {
          '0%, 15%, 100%': { opacity: '0', transform: 'translateY(10px)' },
          '35%, 80%': { opacity: '0.65', transform: 'translateY(0)' },
        },
        stackReveal3: {
          '0%, 30%, 100%': { opacity: '0', transform: 'translateY(10px)' },
          '50%, 80%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
