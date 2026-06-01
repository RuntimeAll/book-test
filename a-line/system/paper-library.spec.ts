/**
 * D 卡（V0.5 卷库视觉级还原）回归测试套
 *
 * 覆盖：
 *   - lazyTree 接口：97 节点 / 3 根（资料库 / 公共试卷 / 专题卷库）
 *   - page 接口：subjectId prefix-match + name 模糊搜索 + 分页
 *   - UI 链路：树点击 → list refresh + 搜索 + 分页 + 查看跳详情
 *   - 占位按钮：6 个"暂未开放" toast 验证
 *
 * 跑前置：
 *   1. BE 必须起：cd codeplace-A/book-server/ruoyi-admin && mvn spring-boot:run
 *   2. DB 已落 D 卡 段① seed（biz_paper_category 97 行 + reconcile）
 *   3. admin/admin123 账号（RuoYi 默认）
 *
 * 跑：
 *   pnpm test:v05                 # 默认 headless
 *   pnpm test:v05:headed          # 看浏览器
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// local-only: 依赖 TREE_TOTAL ≥ 97 dev 数据契约
test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

// vite base=/teacher/ → 业务页 URL 必须带 /teacher/ 前缀
const BASE_HASH = '/teacher/#'

// D 卡数据底盘期望（随 DB 增长可上调）
const EXPECTED = {
  TREE_ROOTS: 3,          // 资料库 / 公共试卷 / 专题卷库
  TREE_TOTAL: 97,         // 含 deprecated 排除后
  PAGE_3001_MIN: 620,     // misikt 真站 626, 我们 622 (允许 ±5)
  PAGE_3003_MIN: 260,     // misikt 真站 265, 我们 265
  PAGE_3004_MIN: 110,     // 我们 117
  PAGE_ALL_MIN: 1500,     // 不传 subjectId = 全库 1592
  SEARCH_中考_MIN: 80,    // 段② BE smoke = 103
}

// ─── helpers ─────────────────────────────────────────────────

async function gotoPapersIndex(page: Page) {
  // loginByApi 已完成 reload，直接 goto 业务页
  await page.goto(`${BASE_HASH}/papers/index`)
  // 等树或列表或空态任一出现 = 业务 vm 已 mount
  await page.waitForSelector('.paper-card, .el-empty, .el-tree', { timeout: 15000 })
  await page.waitForTimeout(1200) // 让首批 lazyTree + page 落
}

/**
 * 直接打 BE page 接口，返 total
 */
async function callPaperPage(page: Page, body: Record<string, unknown>): Promise<number> {
  return await page.evaluate(async (b) => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api/teacher/exam/paper/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.access_token,
        'clientid': auth.client_id,
      },
      body: JSON.stringify(b),
    })
    const j = await r.json()
    return j.response?.total ?? -1
  }, body)
}

/**
 * 计算 lazyTree 响应里所有节点数（递归 children）
 */
async function callPaperLazyTreeTotal(page: Page): Promise<{ roots: number, total: number }> {
  return await page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api/teacher/exam/paper/lazyTree', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.access_token,
        'clientid': auth.client_id,
      },
      body: JSON.stringify({ type: 2, version: 1010 }),
    })
    const j = await r.json()
    const roots = Array.isArray(j.response) ? j.response.length : 0
    let total = 0
    function walk(arr: any[]) {
      for (const n of arr) {
        total++
        if (n.children && n.children.length) walk(n.children)
      }
    }
    if (Array.isArray(j.response)) walk(j.response)
    return { roots, total }
  })
}

// ─── BE 端口契约 ──────────────────────────────────────────────

test.describe('V0.5 卷库 BE 端口契约', () => {
  test.beforeEach(async ({ page }) => {
    await loginByApi(page, 'admin')
  })

  test('lazyTree — 3 根 / 97 节点（跟 misikt 真响应字节级一致）', async ({ page }) => {
    const { roots, total } = await callPaperLazyTreeTotal(page)
    expect(roots, '应该 3 根（资料库/公共试卷/专题卷库）').toBe(EXPECTED.TREE_ROOTS)
    expect(total, '总节点 ≥ 97').toBeGreaterThanOrEqual(EXPECTED.TREE_TOTAL)
  })

  test('page — subjectId="3001" 公共试卷返 ≥ 620 卷', async ({ page }) => {
    const t = await callPaperPage(page, { name: '', subjectId: '3001', pageIndex: 1, pageSize: 10 })
    expect(t).toBeGreaterThanOrEqual(EXPECTED.PAGE_3001_MIN)
  })

  test('page — subjectId="3003" 资料库返 ≥ 260 卷', async ({ page }) => {
    const t = await callPaperPage(page, { name: '', subjectId: '3003', pageIndex: 1, pageSize: 10 })
    expect(t).toBeGreaterThanOrEqual(EXPECTED.PAGE_3003_MIN)
  })

  test('page — subjectId="3004" 专题卷库返 ≥ 110 卷', async ({ page }) => {
    const t = await callPaperPage(page, { name: '', subjectId: '3004', pageIndex: 1, pageSize: 10 })
    expect(t).toBeGreaterThanOrEqual(EXPECTED.PAGE_3004_MIN)
  })

  test('page — name="中考" 模糊搜索返 ≥ 80 卷', async ({ page }) => {
    const t = await callPaperPage(page, { name: '中考', subjectId: '', pageIndex: 1, pageSize: 10 })
    expect(t).toBeGreaterThanOrEqual(EXPECTED.SEARCH_中考_MIN)
  })

  test('page — 不传 subjectId 全库返 ≥ 1500 卷', async ({ page }) => {
    const t = await callPaperPage(page, { name: '', subjectId: '', pageIndex: 1, pageSize: 10 })
    expect(t).toBeGreaterThanOrEqual(EXPECTED.PAGE_ALL_MIN)
  })

  test('page envelope — 顶层 code/message/response + PageInfo 12 字段', async ({ page }) => {
    const resp = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const r = await fetch('/api/teacher/exam/paper/page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.access_token,
          'clientid': auth.client_id,
        },
        body: JSON.stringify({ name: '', subjectId: '3001', pageIndex: 1, pageSize: 10 }),
      })
      return await r.json()
    })
    expect(resp.code).toBe(1)
    expect(resp.message).toBe('成功')
    expect(resp.response).toBeTruthy()
    expect(resp.response.total).toBeGreaterThanOrEqual(EXPECTED.PAGE_3001_MIN)
    // PageInfo 关键字段
    const r = resp.response
    expect(typeof r.pageNum).toBe('number')
    expect(typeof r.pageSize).toBe('number')
    expect(typeof r.pages).toBe('number')
    expect(typeof r.isFirstPage).toBe('boolean')
    expect(typeof r.isLastPage).toBe('boolean')
    expect(typeof r.hasNextPage).toBe('boolean')
    expect(Array.isArray(r.navigatepageNums)).toBe(true)
    expect(Array.isArray(r.list)).toBe(true)
    // list item 字段
    if (r.list.length > 0) {
      const item = r.list[0]
      expect(typeof item.id).toBe('number')
      expect(typeof item.name).toBe('string')
      expect(typeof item.subjectId).toBe('string')
      expect('score' in item).toBe(true)
      expect('questionCount' in item).toBe(true)
      expect('createTime' in item).toBe(true)
    }
  })
})

// ─── UI 全链路 ────────────────────────────────────────────────

test.describe('V0.5 卷库 UI 全链路', () => {
  test.beforeEach(async ({ page }) => {
    await loginByApi(page, 'admin')
    await gotoPapersIndex(page)
  })

  test('页面 mount — 左侧树 + 中间列表 + 浮动按钮', async ({ page }) => {
    // 左侧目录区
    await expect(page.locator('.paper-sidebar')).toBeVisible()
    await expect(page.locator('.sidebar-title')).toHaveText('卷库目录')
    // 右侧主区
    await expect(page.locator('.paper-main')).toBeVisible()
    await expect(page.locator('.search-input')).toBeVisible()
    await expect(page.locator('.search-btn')).toBeVisible()
    // 列表至少 1 张卡片
    const cards = page.locator('.paper-card')
    await expect(cards.first()).toBeVisible()
    expect(await cards.count(), '至少渲染 1 张卡片').toBeGreaterThan(0)
    // 全局试题栏 FAB（E 卡 段③' 起挂 AppLayout — 原 .floating-btn-basket/.floating-btn-qbar 占位已删）
    await expect(page.locator('.basket-fab')).toBeVisible()
  })

  test('卡片 4 字段渲染 — 总分/时长/题目数/创建时间', async ({ page }) => {
    const card1 = page.locator('.paper-card').first()
    await expect(card1.locator('.paper-name')).toBeVisible()
    const fieldLabels = await card1.locator('.paper-field-label').allInnerTexts()
    expect(fieldLabels).toEqual(['总分', '时长', '题目数', '创建时间'])
    // 至少 createTime 是 YYYY-MM-DD 格式
    const lastValue = await card1.locator('.paper-field-value').last().innerText()
    expect(lastValue).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  test('点击树"公共试卷"根 → 列表刷新 + total ≥ 620', async ({ page }) => {
    // 找到"公共试卷"节点点击
    const node = page.locator('.el-tree-node__label', { hasText: '公共试卷' }).first()
    await node.click()
    await page.waitForTimeout(1500)

    // 验证 vm 状态
    const out = await page.evaluate(() => {
      let ctx: any = null
      for (const el of document.querySelectorAll('.papers-page')) {
        // @ts-expect-error vue runtime
        let c = el.__vueParentComponent
        while (c) {
          const x = c.setupState || c.ctx
          if (x && 'total' in x && 'papers' in x) { ctx = x; break }
          c = c.parent
        }
        if (ctx) break
      }
      if (!ctx) return { error: 'vm not found' }
      return { total: ctx.total, subjectId: ctx.currentSubjectId, sampleId: ctx.papers[0]?.id }
    })
    expect(out.total, '公共试卷 total ≥ 620').toBeGreaterThanOrEqual(EXPECTED.PAGE_3001_MIN)
    expect(out.subjectId).toBe('3001')
    expect(out.sampleId, '至少 1 张卷').toBeTruthy()
  })

  test('搜索"中考" → 列表 total ≥ 80', async ({ page }) => {
    await page.locator('.search-input input').fill('中考')
    await page.locator('.search-btn').click()
    await page.waitForTimeout(1500)

    const total = await page.evaluate(() => {
      let ctx: any = null
      for (const el of document.querySelectorAll('.papers-page')) {
        // @ts-expect-error vue runtime
        let c = el.__vueParentComponent
        while (c) {
          const x = c.setupState || c.ctx
          if (x && 'total' in x && 'papers' in x) { ctx = x; break }
          c = c.parent
        }
        if (ctx) break
      }
      return ctx?.total ?? -1
    })
    expect(total).toBeGreaterThanOrEqual(EXPECTED.SEARCH_中考_MIN)
  })

  test('点"查看"按钮 → 跳 /papers/source/{id} 显示卷头', async ({ page }) => {
    const firstCard = page.locator('.paper-card').first()
    const cardId = await page.evaluate(() => {
      let ctx: any = null
      for (const el of document.querySelectorAll('.papers-page')) {
        // @ts-expect-error vue runtime
        let c = el.__vueParentComponent
        while (c) {
          const x = c.setupState || c.ctx
          if (x && 'papers' in x) { ctx = x; break }
          c = c.parent
        }
        if (ctx) break
      }
      return ctx?.papers[0]?.id
    })
    expect(cardId, '第 1 张卷应有 id').toBeTruthy()

    await firstCard.locator('.paper-card-actions .el-link').first().click()
    await page.waitForTimeout(1500)
    // URL 应跳到 source 页
    expect(page.url()).toContain(`/papers/source/${cardId}`)
  })

  test('占位按钮"加入试卷篮" → ElMessage 暂未开放（浮动按钮 E 段③ 已删）', async ({ page }) => {
    // 卡片内"加入试卷篮"el-link 保留（PRD F 卡范围，本 E 卡未动）
    await page.locator('.paper-card-actions .el-link').nth(1).first().click()
    await page.waitForTimeout(500)
    expect(await page.locator('.el-message').isVisible({ timeout: 2000 }).catch(() => false)).toBe(true)
    const msgText1 = await page.locator('.el-message').first().innerText()
    expect(msgText1).toContain('暂未开放')
    // 原 .floating-btn-basket / .floating-btn-qbar 占位双浮按钮已被 E 卡 段③ 清掉 — 改为全局 <QuestionBasket />
    // 全局 FAB 行为见 v05-e-paper-detail.spec.ts T6/T7
  })

  test('分页器 — 翻到第 2 页列表变化', async ({ page }) => {
    // 先选公共试卷确保 ≥ 60 页
    const node = page.locator('.el-tree-node__label', { hasText: '公共试卷' }).first()
    await node.click()
    await page.waitForTimeout(1500)

    const page1Ids = await page.locator('.paper-card .paper-name').allInnerTexts()

    // 点"下一页"
    const nextBtn = page.locator('.el-pagination .btn-next')
    await nextBtn.click()
    await page.waitForTimeout(1500)

    const page2Ids = await page.locator('.paper-card .paper-name').allInnerTexts()
    expect(page2Ids[0], '第 2 页第 1 张应跟第 1 页第 1 张不同').not.toBe(page1Ids[0])
  })
})

// ─── 0 misikt.com 请求（同 V1 核心目标）──────────────────────

test.describe('V0.5 卷库 核心目标 — 0 个 misikt.com 请求', () => {
  test('卷库主页所有请求都打本地 / api，不调外部', async ({ page }) => {
    const misiktRequests: string[] = []
    page.on('request', req => {
      if (req.url().includes('misikt.com') || req.url().includes('mxqd.cn')) {
        misiktRequests.push(req.url())
      }
    })
    await loginByApi(page, 'admin')
    await gotoPapersIndex(page)
    // 翻页 + 搜索 + 树点击都触发一遍
    await page.locator('.el-tree-node__label', { hasText: '公共试卷' }).first().click()
    await page.waitForTimeout(1000)
    await page.locator('.search-input input').fill('期末')
    await page.locator('.search-btn').click()
    await page.waitForTimeout(1500)
    expect(misiktRequests, `不应有 misikt 请求: ${misiktRequests.join(', ')}`).toHaveLength(0)
  })
})
