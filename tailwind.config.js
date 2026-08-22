/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        vibe: {
          50: '#fdf2f8',
          100: '#fce7f3',
          200: '#fbcfe8',
          300: '#f472b6',
          400: '#ec4899',
          500: '#db2777', // TikTok hot pink
          600: '#be185d',
          700: '#9d174d',
          800: '#831843',
          900: '#500724',
          cyan: '#00f2fe',
          teal: '#4facfe',
          neon: '#00ffcc',
          purple: '#8b5cf6',
          yt: '#ff0000',
        },
        dark: {
          bg: '#0a0b10',
          surface: '#121420',
          card: 'rgba(23, 26, 42, 0.75)',
          border: 'rgba(255, 255, 255, 0.08)',
          cardHover: 'rgba(34, 38, 62, 0.85)',
          glass: 'rgba(18, 20, 32, 0.65)',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'spin-slow': 'spin 20s linear infinite',
        'spin-reverse': 'spin-rev 25s linear infinite',
        'pulse-glow': 'pulse-glow 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-subtle': 'bounce-subtle 2s infinite',
        'wave-bar': 'wave-bar 1.2s ease-in-out infinite alternate',
      },
      keyframes: {
        'spin-rev': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(-360deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'wave-bar': {
          '0%': { height: '15%' },
          '100%': { height: '100%' },
        }
      },
      backdropBlur: {
        xs: '2px',
      },
      boxShadow: {
        'glow-pink': '0 0 25px -5px rgba(236, 72, 153, 0.5)',
        'glow-cyan': '0 0 25px -5px rgba(0, 242, 254, 0.5)',
        'glow-purple': '0 0 25px -5px rgba(139, 92, 246, 0.5)',
        'glow-card': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      }
    },
  },
  plugins: [],
}
