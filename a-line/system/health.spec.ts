/**
 * a-line/system/health.spec.ts — A 线核心页「健康守门」
 *
 * PRD-O-003「可信绿」AC3：核心用户流走查无基础报错 ——
 *   - 0 个 非白名单 console error
 *   - 0 个 未捕获异常 (pageerror)
 *   - 0 个 非预期 HTTP 5xx（纯导航期，无写操作）
 *   - 0 个 misikt.com 外链请求（去原网站化红线）
 *
 * 这是「系统现在稳不稳」的一眼守门，与业务断言分离。
 * 任一核心页冒出非白名单 console error / 未捕获异常 / 5xx → 系统有基础问题，必须查。
 *
 * 白名单（已知良性噪声，不判缺陷）：MathJax 走外部 jsdelivr CDN 离线必报（experience-digest 沉淀）、
 * ElementPlus 弃用警告、ResizeObserver loop、favicon。
 */
import { test, expect, type Page } from '@playwright/test'
import { IS_PROD } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// 写操作/dev 数据无关，但依赖本地起服务 + teacher 登录态 → local-only
test.skip(IS_PROD, 'local-only: 健康守门依赖本地起服务 + dev 登录态')

// ─── 已知良性噪声白名单 ────────────────────────────────────────
const BENIGN_CONSOLE = [
  /jsdelivr/i, /mathjax/i,            // MathJax 走外部 CDN，离线/dev 必报 ERR_CONNECTION_CLOSED，不影响业务
  /ERR_CONNECTION/i, /net::ERR/i,     // 同上：外部 CDN 网络错
  /favicon/i,                          // 站点图标缺失，无害
  /ResizeObserver loop/i,             // 浏览器良性告警
  /\[el-[a-z]+\]/i, /deprecat/i,      // ElementPlus 组件弃用警告（warn 级别噪声）
]
function isBenign(t: string): boolean {
  return BENIGN_CONSOLE.some((re) => re.test(t))
}

// ─── teacher 可达核心页（path + 就绪 selector）──────────────────
const CORE_PAGES: { name: string; path: string; ready: string }[] = [
  { name: '我的工作台', path: '/#/workspace',            ready: '.section-card, .el-empty' },
  { name: '题库',       path: '/#/question/index',       ready: '.question-list, .question-card, .el-empty' },
  { name: '题目详情',   path: '/#/question/detail/33781', ready: '.question-card, .detail-mode, .question-detail' },
  { name: '卷库',       path: '/#/papers/index',         ready: '.paper-card, .el-empty' },
  { name: '试卷详情',   path: '/#/papers/source/2798',   ready: '.paper-card, .section, .el-empty' },
  { name: '组卷工作台', path: '/#/question/compose',      ready: '.wb-title, .workbench, .el-empty' },
  { name: '个人资料',   path: '/#/profile',              ready: 'form, .el-form, input' },
]

test.describe('A 线健康守门 — 核心页 0 基础报错', () => {
  for (const pg of CORE_PAGES) {
    test(`${pg.name} ${pg.path} — 无 console error / 未捕获异常 / 5xx / misikt 外链`, async ({ page }) => {
      // 先登录（loginByApi 内含 reload，落在登录后默认页）
      await loginByApi(page, 'teacher')

      const consoleErrors: string[] = []
      const pageErrors: string[] = []
      const serverErrors: string[] = []
      const misiktReqs: string[] = []

      // 监听器在 goto 目标页之前挂，隔离被测页自身的报错
      page.on('console', (m) => {
        if (m.type() === 'error' && !isBenign(m.text())) consoleErrors.push(m.text())
      })
      page.on('pageerror', (e) => pageErrors.push(e.message))
      page.on('response', (r) => {
        if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`)
      })
      page.on('request', (r) => {
        if (/misikt\.com/i.test(r.url())) misiktReqs.push(r.url())
      })

      await page.goto(pg.path)
      // 就绪 selector 不强判（健康断言不依赖它），仅尽量等数据/懒加载落
      await page.waitForSelector(pg.ready, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(1500)

      expect(pageErrors, `${pg.name} 未捕获异常: ${pageErrors.join(' | ')}`).toHaveLength(0)
      expect(serverErrors, `${pg.name} 非预期 5xx: ${serverErrors.join(' | ')}`).toHaveLength(0)
      expect(misiktReqs, `${pg.name} 调了 misikt 外链: ${misiktReqs.join(' | ')}`).toHaveLength(0)
      expect(consoleErrors, `${pg.name} 非白名单 console error: ${consoleErrors.join(' | ')}`).toHaveLength(0)
    })
  }
})
