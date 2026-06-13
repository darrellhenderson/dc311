/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#171717',
          deep: '#0a0a0a',
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f3f4f6',
        },
        border: '#e5e7eb',
        'text-muted': '#6b7280',
        success: '#2ecc71',
        danger: '#e74c3c',
        warning: '#e67e22',
      },
      fontFamily: {
        sans: ['Inter', 'Arial', 'sans-serif'],
        serif: ['Georgia', 'Cambria', '"Times New Roman"', 'Times', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        display: ['1.25rem', { lineHeight: '1.75rem', fontWeight: '700' }],
        body: ['0.875rem', { lineHeight: '1.25rem' }],
        caption: ['0.75rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [],
}
