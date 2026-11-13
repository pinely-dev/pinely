import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  transpilePackages: ["@pinely/shared"],
  webpack: (config, { webpack }) => {
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@x402/,
      }),
    );
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  async redirects() {
    return [
      {
        source: "/legal/privacy",
        destination: "/legal#privacy",
        permanent: false,
      },
      {
        source: "/legal/terms",
        destination: "/legal#terms",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
