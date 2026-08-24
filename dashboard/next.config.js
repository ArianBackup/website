/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The portfolio in front of this proxies /hq-cstbflbv/* through to here, so
  // every URL the browser sees is arianfarhadi.com. Nothing here builds absolute
  // URLs, so no basePath or assetPrefix is needed — Next's own /_next/* assets
  // are covered by their own rewrite rule in ../vercel.json.
};

module.exports = nextConfig;
