const { BUILD_DIR } = require("./build-dir.mjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Remotion bundle has to travel with the render function.
  outputFileTracingIncludes: {
    "/api/render": ["./" + BUILD_DIR + "/**/*"],
  },
};

module.exports = nextConfig;
