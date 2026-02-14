import path from "node:path"
import CopyWebpackPlugin from "copy-webpack-plugin"
import nextWebpack from "next/dist/compiled/webpack/webpack.js"

const cesiumSource = "node_modules/cesium/Build/Cesium"
const cesiumBaseUrl = "cesium"
const cesiumStaticPath = `static/${cesiumBaseUrl}`

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.plugins.push(
        new CopyWebpackPlugin({
          patterns: [
            { from: path.join(cesiumSource, "Workers"), to: `${cesiumStaticPath}/Workers` },
            { from: path.join(cesiumSource, "ThirdParty"), to: `${cesiumStaticPath}/ThirdParty` },
            { from: path.join(cesiumSource, "Assets"), to: `${cesiumStaticPath}/Assets` },
            { from: path.join(cesiumSource, "Widgets"), to: `${cesiumStaticPath}/Widgets` },
          ],
        })
      )

      config.plugins.push(
        new nextWebpack.webpack.DefinePlugin({
          CESIUM_BASE_URL: JSON.stringify(`/_next/static/${cesiumBaseUrl}`),
        })
      )
    }

    return config
  },
}

export default nextConfig
