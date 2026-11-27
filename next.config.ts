import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Netlify's deploy context is a build-time value. Bake only the known preview
  // origin into the build, never a value taken from incoming request headers.
  env: {
    MCPOS_BUILD_PREVIEW_ORIGIN:
      process.env.CONTEXT === "deploy-preview" &&
      process.env.DEPLOY_PRIME_URL?.replace(/\/$/, "") === "https://deploy-preview-12--mcpos-dashboard.netlify.app"
        ? "https://deploy-preview-12--mcpos-dashboard.netlify.app"
        : "",
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
