/**
 * Semantic colors come from CSS variables (theme.css) so they switch with the theme.
 * Tailwind 3 cannot add alpha to `var(...)`, so opacity modifiers (`bg-accent/20`) go through color-mix.
 */
function themeColor(variable) {
  return ({ opacityValue }) =>
    opacityValue === undefined || opacityValue === '1'
      ? `var(${variable})`
      : `color-mix(in srgb, var(${variable}) calc(${opacityValue} * 100%), transparent)`;
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', ':root:not([data-theme="light"])'],
  theme: {
    extend: {
      colors: {
        'bg-app': themeColor('--bg-app'),
        'bg-panel': themeColor('--bg-panel'),
        'bg-surface': themeColor('--bg-surface'),
        'bg-surface-hover': themeColor('--bg-surface-hover'),
        'bg-surface-active': themeColor('--bg-surface-active'),
        'bg-code': themeColor('--bg-code'),
        'border-subtle': themeColor('--border-subtle'),
        'border-default': themeColor('--border-default'),
        'border-strong': themeColor('--border-strong'),
        'text-primary': themeColor('--text-primary'),
        'text-secondary': themeColor('--text-secondary'),
        'text-tertiary': themeColor('--text-tertiary'),
        'text-inverse': themeColor('--text-inverse'),
        accent: {
          DEFAULT: themeColor('--accent'),
          hover: themeColor('--accent-hover'),
          subtle: themeColor('--accent-subtle'),
          foreground: themeColor('--accent-foreground'),
        },
        status: {
          success: themeColor('--color-success'),
          'success-subtle': themeColor('--color-success-subtle'),
          'success-text': themeColor('--color-success-text'),
          warning: themeColor('--color-warning'),
          'warning-subtle': themeColor('--color-warning-subtle'),
          'warning-text': themeColor('--color-warning-text'),
          error: themeColor('--color-error'),
          'error-subtle': themeColor('--color-error-subtle'),
          'error-text': themeColor('--color-error-text'),
          info: themeColor('--color-info'),
          'info-subtle': themeColor('--color-info-subtle'),
          'info-text': themeColor('--color-info-text'),
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
