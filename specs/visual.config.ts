/**
 * PRD-A-013 T0 visual-diff baseline 专用 config.
 * 不复用 playwright.a.config.ts 是因为 testDir 限定 a-line/, 这里要 testDir=specs/.
 *
 * 前置: book-ui :5173 + book-server :8080 已起 (主 session 起的, 本 config 不起 webServer).
 */
import { defineConfig, devices } from '@playwright/test'

const LOCAL_CHROME = process.env.LOCAL_CHROME
  ?? 'D:/workplace/workTool/chrome-win64/chrome.exe'

export default defineConfig({
  testDir: '.',
  timeout: 90000,
  retries: 0,
  // 串行单 worker — visual-diff 必须确定性, 共享 dev DB+BE+LS 不能并行
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  outputDir: '../test-results-visual',
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    video: 'off',
    headless: process.env.HEADED !== '1',
    actionTimeout: 15000,
    navigationTimeout: 45000,
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
  // 主 session 已起 :5173 + :8080, 这里**不**再起 webServer
})
