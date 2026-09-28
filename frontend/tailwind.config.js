/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'bg-app': 'var(--bg-app)',
        'bg-panel': 'var(--bg-panel)',
        'bg-surface': 'var(--bg-surface)',
        'bg-surface-hover': 'var(--bg-surface-hover)',
        'bg-surface-active': 'var(--bg-surface-active)',
        'border-subtle': 'var(--border-subtle)',
        'border-default': 'var(--border-default)',
        'border-strong': 'var(--border-strong)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
          foreground: 'var(--accent-foreground)',
        },
        status: {
          success: 'var(--color-success)',
          'success-subtle': 'var(--color-success-subtle)',
          warning: 'var(--color-warning)',
          'warning-subtle': 'var(--color-warning-subtle)',
          error: 'var(--color-error)',
          'error-subtle': 'var(--color-error-subtle)',
        },
      },
      fontFamily: {
        mono: ['var(--font-mono)'],
        sans: ['var(--font-sans)'],
      },
    },
  },
  plugins: [],
};
