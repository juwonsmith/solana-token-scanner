/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // token logos can come from anywhere; allow remote images
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
};

export default nextConfig;
