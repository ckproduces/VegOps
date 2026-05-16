/** @type {import('next').NextConfig} */
const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";

const nextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/orch/:path*", destination: `${backendUrl}/api/:path*` },
    ];
  },
};
module.exports = nextConfig;
