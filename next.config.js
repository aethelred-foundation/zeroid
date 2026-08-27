const isProduction = process.env.NODE_ENV === "production";
const privateNoStoreCacheControl =
  "private, no-store, no-cache, must-revalidate, proxy-revalidate";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: false,

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.aethelred.io",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          ...(isProduction
            ? [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]
            : []),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "0" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: privateNoStoreCacheControl },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "Vary", value: "Authorization" },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // Proof generation and verification only run from client components.
      // Keeping snarkjs external in the server graph prevents webpack from
      // traversing ffjavascript's Node-only `web-worker` adapter (which uses a
      // dynamic require) while preserving snarkjs's browser bundle in the
      // client graph.
      config.externals = [...(config.externals || []), "snarkjs"];
    }

    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@react-native-async-storage/async-storage": false,
        "pino-pretty": false,
      };

      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        path: false,
        os: false,
      };

      const webpack = require("webpack");
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
    }

    // WASM support for ZK proof verification
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });

    return config;
  },

  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "framer-motion"],
  },
};

module.exports = nextConfig;
