export function resolveAnalyticsUrl(value?: string) {
  const url = new URL(value || 'https://webm8-platform.vercel.app/app');
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  ) {
    throw new Error(
      'VITE_ANALYTICS_URL must use HTTPS, or HTTP on local loopback, without credentials.',
    );
  }
  return url.href;
}
