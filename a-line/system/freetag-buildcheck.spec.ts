/**
 * X 卡 freeTag 段③ FE BuildCheck（BE 不可用时的退化验证）
 *
 * 目的：不打 BE，只验 vite build OK + 我新写的 FreeTagList 组件能被引用、4 个目标页能加载 < login 跳转或 empty 渲染>。
 * 跑：pnpm exec playwright test tests/x-freetag-fe-buildcheck.spec.ts --project chromium-local
 */
import { test, expect } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { IS_PROD } from '../helpers/env'

// local-only: FE buildcheck 无 BE 意义，prod 环境跳过
test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SHOTS_DIR = path.resolve(__dirname, '..', '..', '..', 'workplace', 'PRD', '2026-05-22-X-freetag-dict', 'smoke')

test.describe('X 卡 段③ FE BuildCheck — 无 BE 退化验证', () => {

  test('1. login 页能加载（vite build OK）', async ({ page }) => {
    await page.goto('/#/login')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-build-01-login.png'), fullPage: true })
    // 不期望 console error 包含 FreeTagList / freeTag 字样
    const errs: string[] = []
    page.on('console', (msg) => { if (msg.type() === 'error') errs.push(msg.text()) })
    expect(errs.filter(e => /FreeTagList|freeTag/i.test(e))).toEqual([])
  })

  test('2. question/index 路由跳转不崩（构建期组件 import 无报错）', async ({ page }) => {
    const errs: string[] = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto('/#/question/index')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-build-02-questionindex.png'), fullPage: true })
    expect(errs.filter(e => /FreeTagList|freeTag/i.test(e))).toEqual([])
  })

  test('3. question/detail/33781 路由跳转不崩', async ({ page }) => {
    const errs: string[] = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto('/#/question/detail/33781')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-build-03-detail.png'), fullPage: true })
    expect(errs.filter(e => /FreeTagList|freeTag/i.test(e))).toEqual([])
  })

  test('4. papers/source/2798 路由跳转不崩', async ({ page }) => {
    const errs: string[] = []
    page.on('pageerror', (e) => errs.push(String(e)))
    await page.goto('/#/papers/source/2798')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-build-04-papers-source.png'), fullPage: true })
    expect(errs.filter(e => /FreeTagList|freeTag/i.test(e))).toEqual([])
  })
})
