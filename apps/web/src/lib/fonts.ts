import { Red_Hat_Display } from 'next/font/google';

export const redHatDisplay = Red_Hat_Display({
  subsets: ['latin'],
  variable: '--font-red-hat-display',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700', '800', '900'],
});
