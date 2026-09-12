import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false, // virtual:pwa-register/react のフックから自前で登録するため
      // 既存の public/manifest.json(4.8で作成済み)をそのまま使う。二重管理を避けるため
      // vite-plugin-pwa側でのmanifest生成は行わない
      manifest: false,
      includeManifestIcons: false,
      workbox: {
        // jsonはdist直下のmanifest.json用(他に.jsonファイルは無いため意図しない巻き込みはない)。
        // 当初漏れており、DESIGN.mdが謳う「manifest.jsonもprecache対象」という記述と食い違っていた
        // (コードレビューで発見)
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,json}'],
        navigateFallback: '/index.html',
        // /api/* はWorkers側(run_worker_first)が処理するため、SWのナビゲーション
        // フォールバック対象から除外する(静的アセットのみキャッシュする方針、
        // plans/STEP3_IMPLEMENTATION_PLAN.md 1.1参照)
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
      },
      devOptions: {
        // このプロジェクトの動作確認は一貫して `npm run start`(build + wrangler dev)で
        // 行っており、vite devサーバーでのSW検証は行わない方針に合わせる
        enabled: false,
      },
    }),
  ],
})
