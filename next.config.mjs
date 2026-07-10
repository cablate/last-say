/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev 與 production 可同時存在；分開 build artifacts，避免 dev 熱重載
  // 改寫 `.next` 後讓 production 隨機缺 chunk。
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  // node:sqlite 是 Node 內建模組，僅 server 端可用；App Router route handlers 預設 nodejs runtime。
  serverExternalPackages: ['node:sqlite'],
};

export default nextConfig;
