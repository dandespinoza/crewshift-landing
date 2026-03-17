import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#FFFFFF',
        foreground: '#0A0A0A',
        surface: {
          bg0: '#FFFFFF',
          bg1: '#F7F7F8',
          bg2: '#EEEFF1',
          bg3: '#E4E5E9',
        },
        text: {
          primary: '#0A0A0A',
          secondary: '#3D3D43',
          tertiary: '#6B6B76',
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: '#E4E5E9',
          subtle: '#EEEFF1',
        },
        accent: {
          50:  '#FFF5ED',
          100: '#FFE8D4',
          200: '#FFD0A8',
          300: '#FFB070',
          400: '#FF8F3D',
          500: '#FF751F',
          DEFAULT: '#FF751F',
          600: '#E5641A',
          700: '#CC5415',
          800: '#A84311',
          900: '#7A310D',
          950: '#4A1D08',
        },
        danger: {
          solid: '#EF4444',
          'subtle-bg': '#FEF2F2',
          text: '#DC2626',
          border: '#FECACA',
        },
        success: {
          solid: '#22C55E',
          'subtle-bg': '#F0FDF4',
          text: '#16A34A',
          border: '#BBF7D0',
        },
        warning: {
          solid: '#F59E0B',
          'subtle-bg': '#FFFBEB',
          text: '#D97706',
          border: '#FDE68A',
        },
        info: {
          solid: '#3B82F6',
          'subtle-bg': '#EFF6FF',
          text: '#2563EB',
          border: '#BFDBFE',
        },
        sidebar: {
          bg: '#0A0A0A',
          hover: 'transparent',
          active: 'transparent',
          border: '#1E1E22',
          text: '#8A8A96',
          'text-hover': '#FFFFFF',
          'text-active': '#FF751F',
        },
        muted: {
          DEFAULT: '#F7F7F8',
          foreground: '#6B6B76',
        },
        card: { DEFAULT: '#FFFFFF', foreground: '#0A0A0A' },
        popover: { DEFAULT: '#FFFFFF', foreground: '#0A0A0A' },
        destructive: '#EF4444',
      },
      fontFamily: {
        sans: ['var(--font-red-hat-display)', 'Red Hat Display', 'system-ui', 'sans-serif'],
        heading: ['var(--font-red-hat-display)', 'Red Hat Display', 'system-ui', 'sans-serif'],
        body: ['var(--font-red-hat-display)', 'Red Hat Display', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        'xs':   ['12px', { lineHeight: '1.4' }],
        'sm':   ['13px', { lineHeight: '1.4' }],
        'base': ['15px', { lineHeight: '1.5' }],
        'lg':   ['18px', { lineHeight: '1.4', letterSpacing: '-0.01em' }],
        'xl':   ['22px', { lineHeight: '1.25', letterSpacing: '-0.02em' }],
        '2xl':  ['26px', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
        '3xl':  ['31px', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
        '4xl':  ['38px', { lineHeight: '1.1', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
        md: '12px',
        lg: '14px',
        xl: '16px',
        full: '9999px',
      },
      boxShadow: {
        '1': '0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02)',
        '2': '0 4px 12px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.03)',
        '3': '0 8px 24px rgba(0,0,0,0.10), 0 4px 8px rgba(0,0,0,0.04)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'count-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-subtle': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.7' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'count-up': 'count-up 0.6s ease-out',
        'pulse-subtle': 'pulse-subtle 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
