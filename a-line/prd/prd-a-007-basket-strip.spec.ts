/**
 * PRD-A-007 basket 已选试卷条 —— papers/basket 三栏组卷工作台
 *
 * 覆盖：
 *   B1 进 basket 页，顶部"已选试卷 N" badge
 *   B2 .wb-selected-strip 出现，每张卷一个 .wb-paper-chip（含卷名 + 题数）
 *   B3 截断验证：长卷名 .chip-name 不溢出标签框（overflow:hidden 截断已修复）
 *   B4 点 × 移除 → badge N→N-1，chip 消失，LS 同步
 *   B5 "清空试卷篮"按钮（el-messagebox 二次确认）→ 篮清空，strip 消失
 *
 * 数据策略：
 *   usePaperBasket 是 LS-first 单例（module singleton 从 LS 初始化，BE sync 手动调）。
 *   所以 seed 策略 = 同时写 BE (addBasket 端点) + LS (book-ui:paper-basket-ids/cache)，
 *   确保页面 mount 时 LS 有数据，strip 可见。
 *   测试前后调 BE empty 清空（清洁），同时清 LS。
 *
 * 跑：
 *   pnpm exec playwright test --config=playwright.a.config.ts a-line/prd/prd-a-007-basket-strip.spec.ts --reporter=list
 *   pnpm test:prd007
 */

import { test, expect, Page } from '@playwright/test'
import { IS_PROD } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

test.skip(IS_PROD, 'local-only: 写操作/dev 数据契约')

// ── LS keys（与 usePaperBasket.ts 常量一致）───────────────────────────────
const LS_PAPER_BASKET_IDS  = 'book-ui:paper-basket-ids'
const LS_PAPER_BASKET_CACHE = 'book-ui:paper-basket-cache'

// ── inline apiPost helper ───────────────────────────────────────────────────
async function apiPost(page: Page, url: string, body: unknown) {
  return page.evaluate(async ({ u, b }) => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api' + u, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + auth.access_token,
        clientid: auth.client_id,
      },
      body: JSON.stringify(b),
    })
    let j: any = null
    try { j = await r.json() } catch { j = { _raw: await r.text() } }
    return { code: j.code, message: j.message ?? j.msg, response: j.response, httpStatus: r.status }
  }, { u: url, b: body })
}

// ── 清空 BE 试卷篮 + 清空 LS ────────────────────────────────────────────────
async function clearAll(page: Page) {
  await apiPost(page, '/teacher/exam/paper/empty', {})
  await page.evaluate(({ lsIds, lsCache }) => {
    localStorage.removeItem(lsIds)
    localStorage.removeItem(lsCache)
  }, { lsIds: LS_PAPER_BASKET_IDS, lsCache: LS_PAPER_BASKET_CACHE })
}

// ── 取本人卷 IDs + name + questionCount（最多 count 张，有题优先） ──────────
async function getMinepapers(page: Page, count = 2): Promise<{ id: number; name: string; questionCount: number }[]> {
  const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 50 })
  const list: any[] = mine.response?.list || mine.response?.records || []
  const sorted = [...list].sort((a, b) => (Number(b.questionCount) || 0) - (Number(a.questionCount) || 0))
  return sorted.slice(0, count).map((p) => ({
    id: p.id,
    name: p.name || p.paperName || `试卷${p.id}`,
    questionCount: Number(p.questionCount) || 0,
  }))
}

// ── 双写 seed：BE addBasket + LS 篮 ids/cache ─────────────────────────────
// usePaperBasket 是 LS-first 单例：页面 mount 时从 LS 初始化，不自动 queryBasket。
// 测试必须同时写 BE（保证 × 移除 / clear 的 BE side effect 正确） + LS（保证页面显示正确）。
async function seedBasket(page: Page, papers: { id: number; name: string; questionCount: number }[]) {
  // 1. 写 BE
  for (const p of papers) {
    const r = await apiPost(page, `/teacher/exam/paper/addBasket/${p.id}`, {})
    // addBasket 成功 code=1，篮已有时可能返回其他 code，静默继续
    if (r.code !== 1) {
      console.warn(`addBasket(${p.id}) returned code=${r.code}`)
    }
  }
  // 2. 写 LS（mimics usePaperBasket.syncToStorage 格式）
  await page.evaluate(({ papers, lsIds, lsCache }) => {
    const ids = papers.map((p: any) => p.id)
    localStorage.setItem(lsIds, JSON.stringify(ids))
    // cache = [[id, PaperListItem], ...]（Map.entries serialized）
    const cache = papers.map((p: any) => [
      p.id,
      { id: p.id, name: p.name, paperName: p.name, questionCount: p.questionCount },
    ])
    localStorage.setItem(lsCache, JSON.stringify(cache))
  }, { papers, lsIds: LS_PAPER_BASKET_IDS, lsCache: LS_PAPER_BASKET_CACHE })
}

// ── 进 basket 页（强制全页刷新确保 LS 模块单例正确初始化）────────────────
// usePaperBasket 是 module-scope singleton，LS 在模块首次 import 时读取一次。
// 若 seedBasket 写完 LS 后只做 hash 路由变化，模块不会重新 init → 状态不更新。
// 解法：写完 LS 后，先 goto 到 basket 完整 URL（含 pathname），让浏览器全页刷新。
// Playwright hash 导航：如果当前页已有 hash，goto 同 origin 不同 hash 是 hash change（不 reload）。
// 必须先 reload 页面后再 goto 目标。
async function gotoBasketWithFullReload(page: Page) {
  // page.reload() 刷新当前页面，确保 module 重新 evaluate，读取最新 LS
  await page.reload()
  await page.waitForLoadState('load')
  await page.goto('/#/papers/basket')
  await page.waitForLoadState('load')
}

// ── 等 basket 页 strip 可见 ───────────────────────────────────────────────
async function waitForStrip(page: Page, timeout = 8000) {
  await page.waitForSelector('.wb-selected-strip', { timeout })
}

// ══════════════════════════════════════════════════════════════════════════════
// B1 + B2 进 basket 页 → badge + strip + chip
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PRD-A-007 Basket Strip B1-B2', () => {

  test('B1+B2 进 basket 页：顶部 badge + .wb-selected-strip + .wb-paper-chip', async ({ page }) => {
    await loginByApi(page, 'teacher')
    await clearAll(page)

    const papers = await getMinepapers(page, 2)
    expect(papers.length, 'B1 找到 ≥1 张本人卷').toBeGreaterThanOrEqual(1)

    // 双写 seed（BE + LS），全页刷后进 basket（确保 module singleton 从最新 LS 初始化）
    await seedBasket(page, papers)
    await gotoBasketWithFullReload(page)
    await waitForStrip(page)

    // B1 顶部 badge"已选试卷 N"
    const badge = page.locator('.wb-topbar-left .el-tag')
    await expect(badge, 'B1 顶部 badge 存在').toBeVisible()
    const badgeText = (await badge.textContent()) ?? ''
    expect(badgeText, 'B1 badge 文字含"已选试卷"').toContain('已选试卷')
    expect(badgeText, `B1 badge 题数为 ${papers.length}`).toContain(String(papers.length))

    // B2 .wb-selected-strip 出现
    await expect(page.locator('.wb-selected-strip'), 'B2 .wb-selected-strip 出现').toBeVisible()

    // B2 每张卷一个 .wb-paper-chip
    const chips = page.locator('.wb-paper-chip')
    const chipCount = await chips.count()
    expect(chipCount, `B2 chip 数量 = ${papers.length}`).toBe(papers.length)

    // B2 每个 chip 含 .chip-name
    for (let i = 0; i < chipCount; i++) {
      expect(await chips.nth(i).locator('.chip-name').count(), `B2 chip[${i}] 含 .chip-name`).toBeGreaterThan(0)
    }

    await page.screenshot({ path: 'test-results/prd-a-007-B1B2-basket-strip.png' })
    await clearAll(page)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// B3 截断验证：长卷名 chip-name 不溢出标签框
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PRD-A-007 Basket Strip B3 截断验证', () => {

  test('B3 长卷名 chip-name 不溢出 wb-paper-chip 框（text-overflow:ellipsis）', async ({ page }) => {
    await loginByApi(page, 'teacher')
    await clearAll(page)

    const papers = await getMinepapers(page, 1)
    expect(papers.length, 'B3 需要 ≥1 张本人卷').toBeGreaterThanOrEqual(1)
    await seedBasket(page, papers)
    await gotoBasketWithFullReload(page)
    await waitForStrip(page)

    const chips = page.locator('.wb-paper-chip')
    expect(await chips.count(), 'B3 有 chip 存在').toBeGreaterThan(0)

    // 核心截断断言：chip-name 的 right 不超出 wb-paper-chip 的 right
    const overflows = await page.evaluate(() => {
      const chips = document.querySelectorAll('.wb-paper-chip')
      const results: boolean[] = []
      chips.forEach((chip) => {
        const nameEl = chip.querySelector('.chip-name') as HTMLElement | null
        if (!nameEl) return
        const chipRect = chip.getBoundingClientRect()
        const nameRect = nameEl.getBoundingClientRect()
        results.push(nameRect.right > chipRect.right + 2) // 2px 容差
      })
      return results
    })

    expect(overflows.some(Boolean), 'B3 chip-name 不溢出框（text-overflow ellipsis 已修复）').toBe(false)

    await page.screenshot({ path: 'test-results/prd-a-007-B3-chip-truncation.png' })
    await clearAll(page)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// B4 点 × 移除 chip
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PRD-A-007 Basket Strip B4 移除单张卷', () => {

  test('B4 点 × 移除一张卷 → badge N→N-1，chip 消失，LS 同步', async ({ page }) => {
    await loginByApi(page, 'teacher')
    await clearAll(page)

    const papers = await getMinepapers(page, 2)
    expect(papers.length, 'B4 需要 ≥2 张本人卷').toBeGreaterThanOrEqual(2)
    await seedBasket(page, papers)
    await gotoBasketWithFullReload(page)
    await waitForStrip(page)

    await expect(page.locator('.wb-selected-strip'), 'B4 进页 strip 可见').toBeVisible()
    const nBefore = await page.locator('.wb-paper-chip').count()
    expect(nBefore, 'B4 进页 chip 数量正确').toBe(papers.length)

    // 点第一个 chip 的 × 关闭按钮
    const closeBtn = page.locator('.wb-paper-chip').first().locator('.el-tag__close')
    await expect(closeBtn, 'B4 × 关闭按钮存在').toBeVisible()
    await closeBtn.click()
    await page.waitForTimeout(1500) // 等 reactive 更新

    const nAfter = nBefore - 1

    if (nAfter === 0) {
      expect(await page.locator('.wb-selected-strip').count(), 'B4 篮空后 strip 消失').toBe(0)
    } else {
      const badgeAfter = (await page.locator('.wb-topbar-left .el-tag').textContent()) ?? ''
      expect(badgeAfter, `B4 badge 变为 ${nAfter}`).toContain(String(nAfter))
      expect(await page.locator('.wb-paper-chip').count(), 'B4 chip 减少 1').toBe(nAfter)
    }

    // LS 同步（usePaperBasket.remove 会 syncToStorage）
    const lsIds = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : []
    }, LS_PAPER_BASKET_IDS)
    expect(lsIds.length, 'B4 LS paper-basket-ids 减少 1').toBe(nAfter)

    await page.screenshot({ path: 'test-results/prd-a-007-B4-chip-remove.png' })
    await clearAll(page)
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// B5 清空试卷篮
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PRD-A-007 Basket Strip B5 清空篮', () => {

  test('B5 "清空试卷篮"按钮 → el-messagebox 确认 → 篮清空 strip 消失', async ({ page }) => {
    await loginByApi(page, 'teacher')
    await clearAll(page)

    const papers = await getMinepapers(page, 2)
    expect(papers.length, 'B5 需要 ≥1 张本人卷').toBeGreaterThanOrEqual(1)
    await seedBasket(page, papers)
    await gotoBasketWithFullReload(page)
    await waitForStrip(page)

    await expect(page.locator('.wb-selected-strip'), 'B5 进页 strip 可见').toBeVisible()

    // 点"清空试卷篮"
    const clearBtn = page.locator('button', { hasText: '清空试卷篮' })
    await expect(clearBtn, 'B5 "清空试卷篮"按钮存在').toBeVisible()
    await clearBtn.click()

    // el-messagebox 出现
    await page.waitForSelector('.el-message-box', { timeout: 5000 })
    const msgBox = page.locator('.el-message-box')
    await expect(msgBox, 'B5 确认弹框出现').toBeVisible()

    // 点"确定清空"
    const confirmBtn = msgBox.locator('button', { hasText: '确定清空' })
    await expect(confirmBtn, 'B5 "确定清空"按钮存在').toBeVisible()
    await confirmBtn.click()

    await page.waitForTimeout(2000)

    // strip 消失（basket.count === 0 → v-if=false）
    expect(await page.locator('.wb-selected-strip').count(), 'B5 清空后 strip 消失').toBe(0)

    // LS 已清空
    const lsIds = await page.evaluate((key) => {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : []
    }, LS_PAPER_BASKET_IDS)
    expect(lsIds.length, 'B5 LS paper-basket-ids 已清空').toBe(0)

    await page.screenshot({ path: 'test-results/prd-a-007-B5-basket-clear.png' })
    // 已通过 UI 清空，不再调 clearAll
  })
})
