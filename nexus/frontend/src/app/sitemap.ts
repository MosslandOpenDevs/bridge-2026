import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://bridge.moss.land';

const ROUTES = ['', '/reality-feed', '/proposals', '/delegation', '/outcomes'];

export default function sitemap(): MetadataRoute.Sitemap {
  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route}`,
    changeFrequency: 'daily',
    priority: route === '' ? 1 : 0.7,
  }));
}
