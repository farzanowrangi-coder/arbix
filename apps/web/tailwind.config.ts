import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        terminal: '#0a0a0a',
        panel: '#111111',
        card: '#161616',
        border: '#1e1e1e',
        'border-bright': '#2a2a2a',
        'green-arb': '#00ff88',
        'green-arb-dim': '#00cc6a',
        'green-arb-muted': '#00994f',
        'blue-arb': '#00b4ff',
        'blue-arb-dim': '#0090cc',
        'red-arb': '#ff4444',
        'red-arb-dim': '#cc3333',
        'yellow-arb': '#ffb800',
        'yellow-arb-dim': '#cc9200',
        'text-primary': '#e8e8e8',
        'text-secondary': '#888888',
        'text-muted': '#555555',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Monaco', 'Consolas', 'monospace'],
        sans: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.65rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        'grid-pattern':
          'linear-gradient(rgba(0, 255, 136, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 136, 0.03) 1px, transparent 1px)',
        'glow-green': 'radial-gradient(ellipse at center, rgba(0, 255, 136, 0.15) 0%, transparent 70%)',
        'glow-blue': 'radial-gradient(ellipse at center, rgba(0, 180, 255, 0.15) 0%, transparent 70%)',
      },
      backgroundSize: {
        'grid-sm': '20px 20px',
        'grid-lg': '40px 40px',
      },
      animation: {
        'pulse-green': 'pulseGreen 2s ease-in-out infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'ticker': 'ticker 30s linear infinite',
        'blink': 'blink 1s step-end infinite',
        'glow': 'glow 2s ease-in-out infinite',
      },
      keyframes: {
        pulseGreen: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 5px #00ff88' },
          '50%': { opacity: '0.5', boxShadow: '0 0 20px #00ff88' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(20px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        ticker: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        glow: {
          '0%, 100%': { textShadow: '0 0 10px #00ff88, 0 0 20px #00ff88' },
          '50%': { textShadow: '0 0 20px #00ff88, 0 0 40px #00ff88, 0 0 60px #00ff88' },
        },
      },
      boxShadow: {
        'neon-green': '0 0 10px rgba(0, 255, 136, 0.5), 0 0 20px rgba(0, 255, 136, 0.2)',
        'neon-green-lg': '0 0 20px rgba(0, 255, 136, 0.6), 0 0 40px rgba(0, 255, 136, 0.3)',
        'neon-blue': '0 0 10px rgba(0, 180, 255, 0.5), 0 0 20px rgba(0, 180, 255, 0.2)',
        'neon-red': '0 0 10px rgba(255, 68, 68, 0.5), 0 0 20px rgba(255, 68, 68, 0.2)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.4)',
        'card-hover': '0 8px 32px rgba(0, 0, 0, 0.6)',
      },
      borderColor: {
        'neon-green': 'rgba(0, 255, 136, 0.4)',
        'neon-blue': 'rgba(0, 180, 255, 0.4)',
      },
    },
  },
  plugins: [],
};

export default config;
