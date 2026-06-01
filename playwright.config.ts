import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ESM 下 __dirname 不存在 — 手动构造
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 本地 Chrome for Testing — D:\workplace\workTool\chrome-win64\chrome.exe (v147)
// 没装/改路径 → $env:LOCAL_CHROME='C:/path/to/chrome.exe'
// 完全删本地 Chrome → 删 launchOptions.executablePath + 跑 pnpm exec playwright install chromium
const LOCAL_CHROME = process.env.LOCAL_CHROME
  ?? 'D:/workplace/workTool/chrome-win64/chrome.exe'

// FE dev server 端口（webServer 起 book-ui vite / baseURL 用这个）
const FE_PORT = Number(process.env.FE_PORT ?? 4010)

// book-ui 工程绝对路径（webServer cwd 跨目录跑）
// book-test 已迁 codeplace-O/，book-ui 仍在 codeplace-A/ → 跨两级定位（env 可覆盖）
const BOOK_UI = process.env.BOOK_UI_PATH
  ?? path.resolve(__dirname, '..', '..', 'codeplace-A', 'book-ui')

// BE 8080 必须先手动起（mvn spring-boot:run -pl ruoyi-admin）
// 测试通过 vite proxy /api → http://localhost:8080 间接打 BE
export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${FE_PORT}`,
    screenshot: 'only-on-failure',
    video: 'off',
    headless: process.env.HEADED !== '1',
    actionTimeout: 10000,
    // 首次 page.goto vite 还在预编译 element-plus 等大依赖，30s 兜底
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
  webServer: {
    command: `pnpm dev --port ${FE_PORT}`,
    cwd: BOOK_UI,
    url: `http://localhost:${FE_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // vite 首次启 + element-plus 预编译可达 60s+
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
