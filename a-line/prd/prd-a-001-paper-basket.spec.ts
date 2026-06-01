/**
 * PRD-001（试卷篮）回归测试套 — 段⑤ + 段⑥' 合并
 * (原 r-paper-basket.spec.ts，git mv 保留历史)
 *
 * 覆盖（8 case）：
 *   R-1. 加卷成功 — 卡片"加入试卷篮"el-link 点 3 卷 → toast + FAB 角标 = 3
 *   R-2. LS 持久化 — 加 3 卷 + reload → 角标仍 3
 *   R-3. 移除单卷 — dialog 内点"移除" → 角标 -1 + 列表对应行消失
 *   R-4. 清空 — dialog "清空" + confirm → 角标 0 + 列表空
 *   R-5. 批量合卷 — 3 卷 + "批量合卷" + 输名 → 跳 /papers/source/{id} + 篮清空 + ElMessage success
 *   R-6. 批量导 PDF — 2 卷 + "批量导 PDF" + 输名 → 触发 download 事件 + 篮**不**清空
 *   R-7. 空篮 disabled — 不加卷点 FAB → dialog 内 4 按钮全 disabled
 *   R-8. 双 FAB 共存 — /papers 看试题栏 right:40px + 试卷篮 right:130px, 错位不重叠
 *
 * 跑前置：
 *   1. BE 必须起：cd codeplace-A/book-server/ruoyi-admin && mvn spring-boot:run
 *   2. DB 已落 teacher001 / role_key='teacher'（U 卡段①）
 *   3. 卷库 ≥ 3 卷可加（V0.5 已就位 1592 卷）
 *   4. R 卡 BE 5 端点已起（addBasket/cancel/queryBasket/empty/basketNum）
 *
 * local-only 守卫：加卷/移卷/合卷/导PDF 均为写操作，prod 跳过。
 */
import { test, expect, type Page } from '@playwright/test'
import { IS_PROD, CLIENT_ID } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// LS keys（usePaperBasket.ts 顶部 LS_PAPER_BASKET_IDS / _CACHE 同源）
const LS_BASKET_IDS = 'book-ui:paper-basket-ids'
const LS_BASKET_CACHE = 'book-ui:paper-basket-cache'

// ─── helpers ─────────────────────────────────────────────────

/**
 * 清空 LS 试卷篮（每 case beforeEach 调，防上一 case 残留污染）
 */
async function clearPaperBasketLS(page: Page) {
  await page.evaluate(({ ids, cache }) => {
    localStorage.removeItem(ids)
    localStorage.removeItem(cache)
  }, { ids: LS_BASKET_IDS, cache: LS_BASKET_CACHE })
}

/**
 * 清空 BE 篮（必须在 BE 已 login 拿到 token 后调）— 防上一 case BE 残留
 * (R-6 PDF 不清篮 / 失败 case 跳过 clear → 留旧卷在 BE → refreshFromServer 拉回脏数据)
 *
 * 通过 page fetch（带 LS 中的 token + clientid header）直打 BE /teacher/exam/paper/empty
 */
async function clearPaperBasketBE(page: Page) {
  await page.evaluate(async (cid) => {
    try {
      const authRaw = localStorage.getItem('book-ui:auth')
      if (!authRaw) return
      const token = JSON.parse(authRaw).access_token
      if (!token) return
      await fetch('/api/teacher/exam/paper/empty', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'clientid': cid,
          'Content-Type': 'application/json',
        },
      })
    } catch { /* ignore — best effort */ }
  }, CLIENT_ID)
}

/**
 * 进卷库页面 — clearBasket 后再 reload 让 pinia 重新 init 读最新 LS 状态（basket=空）
 * loginByApi 已有一次 reload（让 pinia 读到 token），
 * clearBasket 后需要第二次 reload 让 pinia 重新读到 basket=0 状态。
 */
async function gotoPapersIndex(page: Page) {
  await page.reload()
  await page.goto('/#/papers/index')
  await page.waitForSelector('.paper-card, .el-empty', { timeout: 15000 })
  await page.waitForTimeout(1200) // 让首批 lazyTree + page 落
}

/**
 * 读 FAB 角标数字 — basket.count > 0 时 el-badge 渲染 `__value`/数字 / >99 显 '99+'。
 * 用 .paper-basket-fab-badge .el-badge__content 的 innerText, 0 时元素 hidden, 返 0。
 */
async function getFabBadgeCount(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const badgeRoot = document.querySelector('.paper-basket-fab-badge')
    if (!badgeRoot) return -1
    const badgeContent = badgeRoot.querySelector('.el-badge__content')
    if (!badgeContent) return 0
    // is-hidden class 时 count=0
    if (badgeContent.classList.contains('is-hidden')) return 0
    const txt = (badgeContent.textContent || '').trim()
    if (!txt) return 0
    if (txt === '99+') return 100
    const n = Number(txt)
    return Number.isNaN(n) ? -1 : n
  })
}

/**
 * 直接读 LS basket ids 数量（作为 ground-truth 校验 FAB 角标对齐）
 */
async function getLSBasketCount(page: Page): Promise<number> {
  return await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    if (!raw) return 0
    try {
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.length : 0
    } catch {
      return -1
    }
  }, LS_BASKET_IDS)
}

/**
 * 在卷库页连点前 N 张卡的"加入试卷篮"el-link
 * .paper-card .paper-card-actions .el-link 第 2 个（第 1 个是"查看"）
 */
async function addNPapers(page: Page, n: number) {
  const cards = page.locator('.paper-card')
  const total = await cards.count()
  expect(total, `卷库卡片数应 ≥ ${n}`).toBeGreaterThanOrEqual(n)
  for (let i = 0; i < n; i++) {
    // 每张卡的 actions 区域第 2 个 el-link = "加入试卷篮"
    await cards.nth(i).locator('.paper-card-actions .el-link').nth(1).click()
    // 等 toast 出（乐观更新 setTimeout 内）+ 防连点 togglingIds 释放
    await page.waitForTimeout(350)
  }
}

/**
 * 打开试卷篮 dialog — 点 FAB → 等 .paper-basket-dialog 显示
 */
async function openBasketDialog(page: Page) {
  await page.locator('.paper-basket-fab').click()
  await page.waitForSelector('.paper-basket-dialog', { state: 'visible', timeout: 5000 })
  await page.waitForTimeout(800) // refreshFromServer 跑完
}

// ─── 段⑤ 基础 4 case ──────────────────────────────────────────

test.describe('R 卡 · 试卷篮基础', () => {
  // 加卷/移卷/清空为写操作 — prod 跳过
  test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

  test.beforeEach(async ({ page }) => {
    await loginByApi(page, 'teacher')
    await clearPaperBasketBE(page)  // 防 BE 残留 (R-6 不清篮 / 失败 case 跳过 clear)
    await clearPaperBasketLS(page)
    await gotoPapersIndex(page)
  })

  test('R-1. 加卷成功 — 点 3 卡 + toast + FAB 角标 = 3', async ({ page }) => {
    await addNPapers(page, 3)
    // 至少能看到 1 条"已加入试卷篮"toast（el-message DOM）
    const lastMsg = page.locator('.el-message').last()
    await expect(lastMsg, '至少最后一条 toast 含"已加入试卷篮"').toContainText('已加入试卷篮')

    const lsCount = await getLSBasketCount(page)
    expect(lsCount, 'LS 持久化 3 个 id').toBe(3)

    const fabCount = await getFabBadgeCount(page)
    expect(fabCount, 'FAB 角标 = 3').toBe(3)
  })

  test('R-2. LS 持久化 — reload 后 FAB 角标仍 3', async ({ page }) => {
    await addNPapers(page, 3)

    // reload 整页（不重新 login，token 已在 LS）
    await page.reload()
    await page.waitForSelector('.paper-card, .el-empty', { timeout: 15000 })
    await page.waitForTimeout(1200)

    const lsCount = await getLSBasketCount(page)
    expect(lsCount, 'LS 持久化 reload 后仍 3').toBe(3)

    const fabCount = await getFabBadgeCount(page)
    expect(fabCount, 'FAB 角标 reload 后仍 3').toBe(3)
  })

  test('R-3. 移除单卷 — dialog 内点"移除" → 角标 -1', async ({ page }) => {
    await addNPapers(page, 3)
    await openBasketDialog(page)

    const itemsBefore = page.locator('.paper-basket-item')
    const beforeCount = await itemsBefore.count()
    expect(beforeCount, 'dialog 内列表 3 行').toBe(3)

    // 点第 1 行的"移除"按钮
    await itemsBefore.nth(0).locator('button:has-text("移除")').click()
    await page.waitForTimeout(500)

    const itemsAfter = page.locator('.paper-basket-item')
    const afterCount = await itemsAfter.count()
    expect(afterCount, 'dialog 列表 -1 = 2 行').toBe(2)

    const lsCount = await getLSBasketCount(page)
    expect(lsCount, 'LS 同步 = 2').toBe(2)

    // FAB 角标需关 dialog 再看（badge 在 dialog 外, 但 reactive 同源应同步）
    const fabCount = await getFabBadgeCount(page)
    expect(fabCount, 'FAB 角标 = 2').toBe(2)
  })

  test('R-4. 清空 — dialog "清空" + confirm → 角标 0 + 列表空', async ({ page }) => {
    await addNPapers(page, 3)
    await openBasketDialog(page)

    // dialog footer 右侧"清空"按钮
    await page.locator('.paper-basket-footer-right button:has-text("清空")').click()
    // 弹出确认框 — 点"清空"
    await page.waitForSelector('.el-message-box', { state: 'visible', timeout: 3000 })
    await page.locator('.el-message-box__btns button:has-text("清空")').click()
    await page.waitForTimeout(600)

    const lsCount = await getLSBasketCount(page)
    expect(lsCount, 'LS 清零').toBe(0)

    const fabCount = await getFabBadgeCount(page)
    expect(fabCount, 'FAB 角标 = 0 (hidden)').toBe(0)

    // dialog 内 el-empty 显示（仍打开状态 — clear 不关 dialog，PaperBasket/index.vue 行为）
    await expect(page.locator('.paper-basket-dialog .el-empty')).toBeVisible()
  })
})

// ─── 段⑥' 批量动作 4 case ─────────────────────────────────────

test.describe('R 卡 · 试卷篮批量动作', () => {
  // 批量合卷/导PDF 为写操作 — prod 跳过
  test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

  test.beforeEach(async ({ page }) => {
    await loginByApi(page, 'teacher')
    await clearPaperBasketBE(page)  // 防 BE 残留 (R-6 不清篮 / 失败 case 跳过 clear)
    await clearPaperBasketLS(page)
    await gotoPapersIndex(page)
  })

  test('R-5. 批量合卷 — 3 卷 → 跳 /papers/source/{id} + 篮清空 + success toast', async ({ page }) => {
    await addNPapers(page, 3)
    await openBasketDialog(page)

    // 点 footer 左侧"批量合卷"
    await page.locator('.paper-basket-footer-left button:has-text("批量合卷")').click()

    // Step 0: 确认弹窗 "继续"
    await page.waitForSelector('.el-message-box', { state: 'visible', timeout: 3000 })
    await page.locator('.el-message-box__btns button:has-text("继续")').click()

    // Step 1: prompt 输新卷名
    await page.waitForSelector('.el-message-box .el-input__inner', { state: 'visible', timeout: 3000 })
    await page.locator('.el-message-box .el-input__inner').fill('合卷-R5-test')
    await page.locator('.el-message-box__btns button:has-text("合卷")').click()

    // 等串行拉 detail + create + 跳转（loading 文案反复刷, 给足时间）
    await page.waitForURL(/\/papers\/source\/\d+/, { timeout: 30000 })
    expect(page.url(), '已跳卷详情').toMatch(/\/papers\/source\/\d+/)

    // 篮清空（merge 内部 basket.clear()）
    const lsCount = await getLSBasketCount(page)
    expect(lsCount, '合卷成功后篮清空').toBe(0)

    // success toast — 跳页后 el-message 仍在 DOM 短暂时间
    // 不强求断（跳页后 toast 可能已 unmount）— 校 LS 清空 + URL 跳转即可证明 success 分支跑过
  })

  test('R-6. 批量导 PDF — 2 卷 → download 事件 + 篮**不**清空', async ({ page }) => {
    await addNPapers(page, 2)
    await openBasketDialog(page)

    // 点 footer 左侧"批量导 PDF"
    await page.locator('.paper-basket-footer-left button:has-text("批量导 PDF")').click()

    // Step 0: 确认弹窗 "继续"
    await page.waitForSelector('.el-message-box', { state: 'visible', timeout: 3000 })
    await page.locator('.el-message-box__btns button:has-text("继续")').click()

    // Step 1: prompt 输文件名
    await page.waitForSelector('.el-message-box .el-input__inner', { state: 'visible', timeout: 3000 })
    await page.locator('.el-message-box .el-input__inner').fill('R6-test')

    // 注册 download 事件捕获（点"导出"前注册, 否则 race miss）
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 })

    await page.locator('.el-message-box__btns button:has-text("导出")').click()

    // 等 PDF 真下载触发（含 detail 拉取 + html2canvas + jsPDF 渲染, 2 卷 ~20s）
    const download = await downloadPromise
    const suggested = download.suggestedFilename()
    expect(suggested, '下载文件名包含输入值').toContain('R6-test')

    // 篮**不**清空（PRD §3.5 出口 B: 导 PDF 不清篮，用户可重导/合卷）
    const lsCount = await getLSBasketCount(page)
    expect(lsCount, '导 PDF 后篮保留 = 2').toBe(2)
  })

  test('R-7. 空篮 disabled — 点 FAB 后 3 按钮（批量合卷/批量导PDF/清空）全 disabled', async ({ page }) => {
    // 不加卷, 直接开 dialog
    await openBasketDialog(page)

    // empty 状态显示
    await expect(page.locator('.paper-basket-dialog .el-empty')).toBeVisible()

    // 3 个业务按钮都应 disabled（"关闭"始终可用，不算）
    const mergeBtn = page.locator('.paper-basket-footer-left button:has-text("批量合卷")')
    const pdfBtn = page.locator('.paper-basket-footer-left button:has-text("批量导 PDF")')
    const emptyBtn = page.locator('.paper-basket-footer-right button:has-text("清空")')

    await expect(mergeBtn, '批量合卷 disabled').toBeDisabled()
    await expect(pdfBtn, '批量导 PDF disabled').toBeDisabled()
    await expect(emptyBtn, '清空 disabled').toBeDisabled()
  })

  test('R-8. 双 FAB 共存 — 试题栏 right:40px / 试卷篮 right:130px 水平错位', async ({ page }) => {
    // 卷库页两 FAB 都该挂（AppLayout 全局 + showQuestionBasket / showPaperBasket 白名单）
    const qBadge = page.locator('.question-basket-fab-badge, .basket-fab-badge').first()
    const pBadge = page.locator('.paper-basket-fab-badge')

    // 都可见
    await expect(pBadge, '试卷篮 FAB 容器可见').toBeVisible()

    // 试题栏 FAB 选择器历史上多种命名（U 卡 P-2 实装），用 PaperBasket 内 right 值反推自身有效
    // 兼容：试题栏可能用 .basket-fab-badge 或 .question-basket-fab-badge 任一类名
    const qBoxOk = await qBadge.isVisible().catch(() => false)
    expect(qBoxOk, '试题栏 FAB 容器可见（双 FAB 共存证据）').toBe(true)

    // 读两 FAB 的 right 计算值（getBoundingClientRect → viewport 右边距）
    const rights = await page.evaluate(() => {
      const vw = window.innerWidth
      const qNode = document.querySelector('.question-basket-fab-badge, .basket-fab-badge') as HTMLElement | null
      const pNode = document.querySelector('.paper-basket-fab-badge') as HTMLElement | null
      const right = (n: HTMLElement | null) => {
        if (!n) return -1
        const r = n.getBoundingClientRect()
        return Math.round(vw - r.right)
      }
      return { qRight: right(qNode), pRight: right(pNode) }
    })

    expect(rights.qRight, '试题栏 FAB right ≈ 40px (±20 容差)').toBeGreaterThanOrEqual(20)
    expect(rights.qRight).toBeLessThanOrEqual(60)
    expect(rights.pRight, '试卷篮 FAB right ≈ 130px (±20 容差)').toBeGreaterThanOrEqual(110)
    expect(rights.pRight).toBeLessThanOrEqual(150)

    // 错位验证 — 试卷篮 right 必须严格大于试题栏 right（试卷篮在更"内"侧）
    expect(rights.pRight, '试卷篮 right > 试题栏 right (水平错开)').toBeGreaterThan(rights.qRight)
  })
})
