import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './athli/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ---- athli / shadcn semantic tokens (driven by CSS vars in globals.css) ----
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        chart: {
          '1': 'var(--chart-1)',
          '2': 'var(--chart-2)',
          '3': 'var(--chart-3)',
          '4': 'var(--chart-4)',
          '5': 'var(--chart-5)',
        },
        sidebar: {
          DEFAULT: 'var(--sidebar)',
          foreground: 'var(--sidebar-foreground)',
          primary: 'var(--sidebar-primary)',
          'primary-foreground': 'var(--sidebar-primary-foreground)',
          accent: 'var(--sidebar-accent)',
          'accent-foreground': 'var(--sidebar-accent-foreground)',
          border: 'var(--sidebar-border)',
          ring: 'var(--sidebar-ring)',
        },
        // ---- Sculptr existing palette (preserved from db) ----
        clinical: {
          white: '#fafafa',
          light: '#f5f5f5',
          grey: '#e5e5e5',
          text: '#1a1a2e',
          muted: '#6b7280',
        },
        brand: {
          DEFAULT: '#0f52ba',
          50: '#eff5ff',
          100: '#dbe8fe',
          200: '#bfd4fe',
          300: '#93b4fd',
          400: '#6090fa',
          500: '#3b6cf5',
          600: '#0f52ba',
          700: '#0c4299',
          800: '#0e3678',
          900: '#0a2a5e',
        },
        slate: {
          50: '#f8f9fa',
          100: '#f1f3f6',
          150: '#e8eef5',
          200: '#e0e7f1',
          300: '#cbd4e8',
          400: '#b0c0dc',
          500: '#8fa3c9',
          600: '#5f7aaa',
          700: '#3d5583',
          800: '#1f2d4d',
          900: '#0a1628',
          950: '#050a14',
        },
        luxe: {
          sapphire: '#1f4d8f',
          emerald: '#1a5d4d',
          gold: '#c9a961',
          rose: '#d4725a',
          violet: '#6b4fa8',
        },
        status: {
          success: '#4db88a',
          warning: '#d4a574',
          error: '#c96b5f',
          info: '#6b9ac9',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        'glass-xs': '0 2px 8px rgba(0, 0, 0, 0.05)',
        glass: '0 8px 32px rgba(0, 0, 0, 0.1)',
        'glass-lg': '0 20px 60px rgba(0, 0, 0, 0.15)',
        'glass-xl': '0 30px 80px rgba(0, 0, 0, 0.2)',
      },
      backdropBlur: {
        xs: '4px',
        sm: '8px',
        glass: '16px',
        'glass-lg': '24px',
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'spin': 'spin 1s linear infinite',
      },
      keyframes: {
        'accordion-down': {
          from: { opacity: '0', height: '0' },
          to: { opacity: '1', height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { opacity: '1', height: 'var(--radix-accordion-content-height)' },
          to: { opacity: '0', height: '0' },
        },
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
