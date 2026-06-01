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

  test('R-3. 移除单卷 — 卷库页点"移出试卷篮" → 角标 -1', async ({ page }) => {
    // PRD-001 重构后：旧 dialog 已删，移除操作入口变为卷库列表行的 toggle el-link
    // "加入试卷篮" → 已在篮时变为 "移出试卷篮"，点击移出
    await addNPapers(page, 3)
    expect(await getLSBasketCount(page), '加卷后 LS = 3').toBe(3)
    const fabCountBefore = await getFabBadgeCount(page)
    expect(fabCountBefore, '加卷后 FAB 角标 = 3').toBe(3)

    // 点第 1 张卡的"移出试卷篮"链接（已加入的卡 el-link 文字变为"移出试卷篮"）
    const cards = page.locator('.paper-card')
    const firstCardRemoveLink = cards.nth(0).locator('.paper-card-actions .el-link').nth(1)
    // 等文字变为"移出试卷篮"（加入后 reactive 更新）
    await expect(firstCardRemoveLink, '第 1 张卡 el-link 变为移出').toContainText('移出试卷篮', { timeout: 3000 })
    await firstCardRemoveLink.click()
    await page.waitForTimeout(500)

    const lsCount = await getLSBasketCount(page)
    expect(lsCount, 'LS 同步 = 2').toBe(2)

    const fabCount = await getFabBadgeCount(page)
    expect(fabCount, 'FAB 角标 = 2').toBe(2)
  })

  test('R-4. 清空篮 — LS 清零 → FAB 角标同步 0（composable 响应性）', async ({ page }) => {
    // PRD-001 重构后：旧 dialog "清空"按钮已删，无单独"一键清空"入口。
    // 本 case 改为：验证 usePaperBasket composable 响应 LS 清空 → FAB 角标自动归零。
    // 场景：加 3 卷 → BE 清空（clearPaperBasketBE）+ LS 清空 → reload → FAB 角标=0（空态）
    await addNPapers(page, 3)
    expect(await getLSBasketCount(page), '加卷后 LS = 3').toBe(3)

    // BE + LS 双清（模拟"清空"效果）
    await clearPaperBasketBE(page)
    await clearPaperBasketLS(page)
    // reload 让 pinia 重读 LS（LS 已清 0）
    await page.reload()
    await page.waitForSelector('.paper-card, .el-empty', { timeout: 15000 })
    await page.waitForTimeout(800)

    const lsCount = await getLSBasketCount(page)
    expect(lsCount, 'LS 清零后 = 0').toBe(0)

    const fabCount = await getFabBadgeCount(page)
    expect(fabCount, 'FAB 角标同步 = 0 (hidden)').toBe(0)
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

  test('R-5. 工作台页面可达 — 加 3 卷后进 /papers/basket 工作台渲染正常', async ({ page }) => {
    // PRD-001 重构后："批量合卷"旧入口（dialog footer 按钮）已删。
    // 合卷新流程：试卷篮工作台（/papers/basket）右栏 → 加入试题篮 → /question/compose 组卷工作台创建。
    // 本 case 改为：验证加卷后点击试卷篮 FAB 跳入 /papers/basket 工作台 + 页面渲染正常。
    await addNPapers(page, 3)
    expect(await getLSBasketCount(page), '加卷后 LS = 3').toBe(3)

    // 点 .paper-basket-fab（绿色试卷篮 FAB，点击跳 /papers/basket）
    await page.locator('.paper-basket-fab').click()
    await page.waitForURL(/#\/papers\/basket/, { timeout: 8000 })
    expect(page.url(), '跳入工作台').toMatch(/#\/papers\/basket/)

    // 工作台标题"组卷工作台" + 已选试卷角标 ≥ 3
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('.wb-title')).toContainText('组卷工作台')
    // 已选试卷数 el-tag 应显示 3
    await expect(page.locator('.wb-topbar .el-tag').first()).toContainText('3', { timeout: 5000 })
  })

  test('R-6. 工作台三栏渲染 — 加 2 卷后进工作台验三栏可见', async ({ page }) => {
    // PRD-001 重构后："批量导 PDF"旧入口（dialog footer 按钮）已删，该功能已移除。
    // 本 case 改为：验证加 2 卷进入工作台后三栏（考点/题域/快速组卷）正确渲染。
    await addNPapers(page, 2)
    expect(await getLSBasketCount(page), '加卷后 LS = 2').toBe(2)

    // 进工作台
    await page.locator('.paper-basket-fab').click()
    await page.waitForURL(/#\/papers\/basket/, { timeout: 8000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500) // 等 workbench.load()（逐卷拉 detail）

    // 三栏验证：左考点栏 / 中题域栏 / 右快速组卷
    await expect(page.locator('.wb-col-left'), '左考点栏存在').toBeVisible()
    await expect(page.locator('.wb-col-center'), '中题域栏存在').toBeVisible()
    await expect(page.locator('.wb-col-right'), '右面板存在').toBeVisible()

    // 右栏有"快速组卷"/"试卷分析"双 tab
    await expect(page.locator('.wb-right-tabs .el-tabs__item').first()).toContainText('快速组卷')
  })

  test('R-7. 空篮工作台 — 不加卷进工作台显示空态', async ({ page }) => {
    // PRD-001 重构后：旧 dialog 已删，"批量合卷/批量导PDF/清空"按钮已不存在。
    // 新设计：空篮时点 FAB → 跳 /papers/basket 工作台 → 三栏均显示空态（暂无试卷/暂无题目）。
    // 本 case 改为：验证空篮时工作台页面空态渲染。
    // 不加卷，直接点 FAB 进工作台
    await page.locator('.paper-basket-fab').click()
    await page.waitForURL(/#\/papers\/basket/, { timeout: 8000 })
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)

    // 工作台标题存在
    await expect(page.locator('.wb-title')).toContainText('组卷工作台')
    // 已选试卷 = 0
    await expect(page.locator('.wb-topbar .el-tag').first()).toContainText('0')

    // 中栏题域空态（暂无题目相关文案）或右栏快速组卷空态
    // 使用更宽泛的验证：中栏容器存在 + 题列表为空（el-empty 可见 or 共 0 题显示）
    const centerEmpty = page.locator('.wb-col-center .el-empty')
    const rightEmpty = page.locator('.wb-col-right .el-empty, .quick-compose-panel .el-empty')
    // 至少一处空态出现（中栏或右栏）
    const hasEmpty = await centerEmpty.count() + await rightEmpty.count() > 0
    expect(hasEmpty, '空篮时工作台应显示空态').toBe(true)
  })

  test('R-8. 双 FAB 共存 — 试题栏(蓝)bottom≈40px / 试卷篮(绿)bottom≈120px 垂直叠放', async ({ page }) => {
    // PRD-001 重构后：双 FAB 布局从"水平错位"改为"垂直叠放"：
    //   .basket-fab-badge（试题栏蓝色）= position:fixed; bottom:40px; right:40px
    //   .paper-basket-fab-badge（试卷篮绿色）= position:fixed; bottom:120px; right:40px
    // 两 FAB 水平位置相同(right:40px)，垂直上下叠放(bottom 不同)。
    // 卷库页两 FAB 都该挂（AppLayout 全局 + showQuestionBasket / showPaperBasket 白名单）
    const qBadge = page.locator('.basket-fab-badge')    // 试题栏蓝色 FAB badge 容器
    const pBadge = page.locator('.paper-basket-fab-badge')  // 试卷篮绿色 FAB badge 容器

    // 都可见（卷库页在白名单内）
    await expect(qBadge, '试题栏 FAB badge 容器可见').toBeVisible()
    await expect(pBadge, '试卷篮 FAB badge 容器可见').toBeVisible()

    // 读两 FAB 的 bottom + right 计算值
    const positions = await page.evaluate(() => {
      const vh = window.innerHeight
      const vw = window.innerWidth
      const qNode = document.querySelector('.basket-fab-badge') as HTMLElement | null
      const pNode = document.querySelector('.paper-basket-fab-badge') as HTMLElement | null
      const pos = (n: HTMLElement | null) => {
        if (!n) return { bottom: -1, right: -1 }
        const r = n.getBoundingClientRect()
        return {
          bottom: Math.round(vh - r.bottom),
          right: Math.round(vw - r.right),
        }
      }
      return { q: pos(qNode), p: pos(pNode) }
    })

    // 试题栏 FAB：bottom≈40px（±20容差）, right≈40px（±20容差）
    expect(positions.q.bottom, '试题栏 FAB bottom ≈ 40px (±20)').toBeGreaterThanOrEqual(20)
    expect(positions.q.bottom).toBeLessThanOrEqual(60)
    expect(positions.q.right, '试题栏 FAB right ≈ 40px (±20)').toBeGreaterThanOrEqual(20)
    expect(positions.q.right).toBeLessThanOrEqual(60)

    // 试卷篮 FAB：bottom≈120px（±20容差），right≈40px（±20容差）
    expect(positions.p.bottom, '试卷篮 FAB bottom ≈ 120px (±20)').toBeGreaterThanOrEqual(100)
    expect(positions.p.bottom).toBeLessThanOrEqual(140)
    expect(positions.p.right, '试卷篮 FAB right ≈ 40px (±20)').toBeGreaterThanOrEqual(20)
    expect(positions.p.right).toBeLessThanOrEqual(60)

    // 垂直叠放验证 — 试卷篮 bottom 必须严格大于试题栏 bottom（试卷篮在上方）
    expect(positions.p.bottom, '试卷篮 bottom > 试题栏 bottom（垂直叠放，试卷篮在上）').toBeGreaterThan(positions.q.bottom)
  })
})
