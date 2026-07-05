import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BRIDGE 2026 — Moss Coin Holder DAO',
    short_name: 'BRIDGE',
    description:
      'Physical AI Expansion. Where agents propose, people decide, reality updates.',
    start_url: '/',
    display: 'standalone',
    background_color: '#052e16',
    theme_color: '#16a34a',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
