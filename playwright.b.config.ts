/**
 * B 线（book-admin）Playwright 配置 — 不起 FE webServer。
 *
 * 与 playwright.a.config.ts 区别：
 * - testDir './b-line' — 只跑 B 线 spec
 * - 无 webServer 段 — admin spec 是 BE-driven（直接打 7888 API），不需要 FE dev server
 * - baseURL 指向 BE 7888 直接打（spec 内部也用 BE_BASE 兜底）
 * - 仍走 Chrome for Testing（沿用 LOCAL_CHROME 约定，未来扩 UI spec 不用重配）
 * - B 线本阶段不接 TEST_ENV prod 切换（后续卡处理）
 *
 * 跑：
 *   pnpm test:b   →  playwright test --config=playwright.b.config.ts --workers=1
 */
import { defineConfig, devices } from '@playwright/test'

const LOCAL_CHROME = process.env.LOCAL_CHROME
  ?? 'D:/workplace/workTool/chrome-win64/chrome.exe'

export default defineConfig({
  testDir: './b-line',
  timeout: 60000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-admin', open: 'never' }]],
  outputDir: 'test-results-admin',
  use: {
    baseURL: process.env.BE_BASE_URL ?? 'http://localhost:7888',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: process.env.HEADED !== '1',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium-local',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: LOCAL_CHROME,
        },
      },
    },
  ],
  // 注意：本 config 故意不带 webServer 段 — admin E2E 走 BE-driven，
  // BE 7888 + DB 由用户/CI 提前手动起。
})
