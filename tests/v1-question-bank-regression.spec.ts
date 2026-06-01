/**
 * V1 卡（题库去原网站化）回归测试套
 *
 * 覆盖 2026-05-21 修过的 4 个 bug + 数据建模 W-6 ETL 修复后的章节关联：
 *   Bug A — 试题栏 cancel 端点（FE removeBasket 改打 /cancel/{id}）
 *   Bug B — 章节树点击 0 题 → BUG-2 真修走 biz_question_knowledge JOIN
 *   Bug C — 难度筛选 difficult ≠ difficulty 字段对齐
 *   Bug D — keyWord 中文筛选（PS curl 编码踩坑，axios 实际 OK）
 *   核心目标 — 整会话 0 个 misikt.com 请求
 *
 * 跑前置：
 *   1. BE 必须起：cd codeplace-A/book-server/ruoyi-admin && mvn spring-boot:run
 *   2. DB 已落 W-6 修复（miskt_data2.biz_subject 2116 行 / 占位名 0）
 *   3. admin/admin123 账号存在（RuoYi 默认）
 *
 * 跑：
 *   pnpm test:v1                 # 默认 headless
 *   pnpm test:v1:headed          # 看浏览器
 *   pnpm test:v1 --grep BUG-2    # 跑单组
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD } from './helpers/env'
import { loginByApi } from './helpers/auth'

// local-only: 依赖 biz_subject ≥ 2116 dev 数据契约
test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

// W-6 修复后的章节关联期望（biz_question_knowledge JOIN 后）
// 这些数字会随题库增长而变大 — 用 >= 断言不用 ===
const EXPECTED_MIN = {
  TOTAL_ALL: 29000,         // 全题最低 29422
  SUBJECT_3071: 4000,       // 浙教版数学 4506
  SUBJECT_3072: 3000,       // 七年级下册 3355
  SUBJECT_3010001: 700,     // 第一章 数与式 733
  DIFFICULT_4: 300,         // 难度 4 = 328
  QUESTION_TYPE_1: 11000,   // 选择题 11908
  KEYWORD_矩形: 800,        // 关键词"矩形" = 910
}

// ─── 公共 helper ──────────────────────────────────────────────

/**
 * 进题库页且确保 vm 已挂载。
 * loginByApi 已完成 reload，直接 goto 业务页。
 */
async function gotoQuestionIndex(page: Page) {
  await page.goto('/#/question/index')
  await page.waitForSelector('.el-select, .question-list, .el-empty', { timeout: 15000 })
  await page.waitForTimeout(1000) // 让 lazyTree / questionPage 首批结果落
}

/**
 * 在已登录的 page 里调 /api/teacher/question/page，返 total
 * 直接走真接口，覆盖 vite proxy 链路 + BE 端到端
 */
async function callQuestionPage(page: Page, body: Record<string, unknown>): Promise<number> {
  return await page.evaluate(async (b) => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api/teacher/question/page', {
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
 * 找题库页 vm（filter + onSearch + handleNodeClick 都挂这上面）
 */
async function findQuestionVmCtx(page: Page) {
  return await page.evaluate(() => {
    for (const el of document.querySelectorAll('.el-input')) {
      // @ts-expect-error vue runtime API
      let c = el.__vueParentComponent
      while (c) {
        const ctx = c.setupState || c.ctx
        if (ctx && ctx.filter && 'difficulty' in ctx.filter) return true
        c = c.parent
      }
    }
    return false
  })
}

// ─── 测试本体 ─────────────────────────────────────────────────

test.describe('V1 卡 BE 端口契约 — curl 级别', () => {
  test.beforeEach(async ({ page }) => {
    await loginByApi(page, 'admin')
  })

  test('Bug C — 难度筛选 difficult=4 命中（FE difficulty→difficult 字段对齐）', async ({ page }) => {
    const all = await callQuestionPage(page, { pageIndex: 1, pageSize: 1 })
    const diff4 = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, difficult: 4 })
    expect(all).toBeGreaterThanOrEqual(EXPECTED_MIN.TOTAL_ALL)
    expect(diff4).toBeGreaterThanOrEqual(EXPECTED_MIN.DIFFICULT_4)
    expect(diff4).toBeLessThan(all)
  })

  test('题型筛选 questionType=1 选择题命中', async ({ page }) => {
    const type1 = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, questionType: 1 })
    expect(type1).toBeGreaterThanOrEqual(EXPECTED_MIN.QUESTION_TYPE_1)
  })

  test('Bug D — 关键词中文筛选（axios 默认 UTF-8）', async ({ page }) => {
    const t = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, keyWord: '矩形' })
    expect(t).toBeGreaterThanOrEqual(EXPECTED_MIN.KEYWORD_矩形)
  })

  test('BUG-2 真修 — 章节走 biz_question_knowledge JOIN（3071/3072/3010001 都有题）', async ({ page }) => {
    const r3071 = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, subjectId: '3071' })
    const r3072 = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, subjectId: '3072' })
    const r3010001 = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, subjectId: '3010001' })
    expect(r3071, '3071 浙教版数学').toBeGreaterThanOrEqual(EXPECTED_MIN.SUBJECT_3071)
    expect(r3072, '3072 七年级下册（旧实现 0 题，新实现应 ≥ 3000）').toBeGreaterThanOrEqual(EXPECTED_MIN.SUBJECT_3072)
    expect(r3010001, '3010001 第一章 数与式（旧实现 0 题）').toBeGreaterThanOrEqual(EXPECTED_MIN.SUBJECT_3010001)
  })

  test('SQL 注入防护 — subjectId 非法值返空集而非报错', async ({ page }) => {
    const r = await callQuestionPage(page, { pageIndex: 1, pageSize: 1, subjectId: "1 OR 1=1" })
    expect(r).toBe(0)
  })

  test('Bug A — POST /teacher/question/cancel/{id} 返 code:1', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const r = await fetch('/api/teacher/question/cancel/37070', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.access_token,
          'clientid': auth.client_id,
        },
      })
      return await r.json()
    })
    expect(result.code).toBe(1)
    expect(result.message).toBe('操作成功')
  })

  test('Bug A 反例 — 旧错路径 /removeBasket/{id} 应返 404', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const r = await fetch('/api/teacher/question/removeBasket/37070', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.access_token,
          'clientid': auth.client_id,
        },
      })
      return await r.json()
    })
    expect(result.code).toBe(404)
  })

  // J 卡段② BE 新加字段 — /page 响应每条 question 带 isFavorite boolean
  test('J 卡段② — /page 响应每条 question 含 isFavorite 字段（LEFT JOIN biz_question_favorite）', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const r = await fetch('/api/teacher/question/page', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + auth.access_token,
          'clientid': auth.client_id,
        },
        body: JSON.stringify({ pageIndex: 1, pageSize: 5 }),
      })
      return await r.json()
    })
    expect(result.code, 'BE 应返 code=1').toBe(1)
    const list = result.response?.list ?? result.data?.list ?? []
    expect(list.length, '至少返 1 条题').toBeGreaterThan(0)
    // 每条 question 必须有 isFavorite 字段（boolean 或 null — Boolean 类型）
    for (const q of list) {
      expect(q, `题 ${q.id} 应含 isFavorite 字段`).toHaveProperty('isFavorite')
      const v = q.isFavorite
      expect([true, false, null, 0, 1].includes(v), `isFavorite 值 ${v} 类型应为 boolean / null / 0 / 1`).toBe(true)
    }
  })
})

test.describe('V1 卡 UI 全链路 — 题库页', () => {
  test.beforeEach(async ({ page }) => {
    await loginByApi(page, 'admin')
    await gotoQuestionIndex(page)
    expect(await findQuestionVmCtx(page), '题库页 vm 未挂载').toBe(true)
  })

  test('筛选 UI 链路 — 难度 / 题型 / 关键词', async ({ page }) => {
    const out = await page.evaluate(async () => {
      let ctx: any = null
      for (const el of document.querySelectorAll('.el-input')) {
        // @ts-expect-error vue runtime
        let c = el.__vueParentComponent
        while (c) {
          const x = c.setupState || c.ctx
          if (x && x.filter && 'difficulty' in x.filter) { ctx = x; break }
          c = c.parent
        }
        if (ctx) break
      }
      if (!ctx) return { error: 'vm not found' }
      const sleep = (n: number) => new Promise<void>(r => setTimeout(r, n))

      const init = ctx.total
      ctx.filter.difficulty = 4
      await ctx.onSearch(); await sleep(1000)
      const diff4 = ctx.total
      ctx.onReset(); await sleep(600)

      ctx.filter.questionType = 1
      await ctx.onSearch(); await sleep(1000)
      const type1 = ctx.total
      ctx.onReset(); await sleep(600)

      ctx.filter.keyWord = '矩形'
      await ctx.onSearch(); await sleep(1000)
      const kw = ctx.total
      ctx.onReset(); await sleep(600)

      return { init, diff4, type1, kw, afterReset: ctx.total }
    })
    expect(out.init).toBeGreaterThanOrEqual(EXPECTED_MIN.TOTAL_ALL)
    expect(out.diff4).toBeGreaterThanOrEqual(EXPECTED_MIN.DIFFICULT_4)
    expect(out.type1).toBeGreaterThanOrEqual(EXPECTED_MIN.QUESTION_TYPE_1)
    expect(out.kw).toBeGreaterThanOrEqual(EXPECTED_MIN.KEYWORD_矩形)
    expect(out.afterReset).toBe(out.init)
  })

  test('章节树点击 — 3072 七年级下册有 3000+ 题', async ({ page }) => {
    const out = await page.evaluate(async () => {
      let ctx: any = null
      for (const el of document.querySelectorAll('.el-input')) {
        // @ts-expect-error vue runtime
        let c = el.__vueParentComponent
        while (c) {
          const x = c.setupState || c.ctx
          if (x && x.filter && 'difficulty' in x.filter) { ctx = x; break }
          c = c.parent
        }
        if (ctx) break
      }
      ctx.handleNodeClick({ id: '3072', name: '七年级下册' })
      await new Promise<void>(r => setTimeout(r, 1500))
      return { total: ctx.total, sample: ctx.questions[0]?.id }
    })
    expect(out.total).toBeGreaterThanOrEqual(EXPECTED_MIN.SUBJECT_3072)
    expect(out.sample, '列表至少有 1 题').toBeTruthy()
  })

  test('Bug A — basket toggle 加/移无 ElMessage error（E 段③ composable 化后改读 LS + UI 点击）', async ({ page }) => {
    const errorMessages: string[] = []
    page.on('console', m => {
      if (m.type() === 'error') errorMessages.push(m.text())
    })

    // 清初始 LS basket
    await page.evaluate(() => {
      localStorage.removeItem('book-ui:basket-ids')
      localStorage.removeItem('book-ui:basket-cache')
    })

    // 点第一题"+试题栏" UI 按钮（CSS 类沿用现有：.action-btn--basket）
    const basketBtn = page.locator('.question-card').first().locator('.action-btn--basket').first()
    await basketBtn.waitFor({ state: 'visible', timeout: 10000 })
    const qid = await page.locator('.question-card').first().getAttribute('data-question-id').catch(() => null)
    await basketBtn.click()
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]').length >= 1,
      { timeout: 5000 },
    )
    const idsAfterAdd = await page.evaluate(() => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]'))
    expect(idsAfterAdd.length, '加后 basket-ids 至少 1').toBeGreaterThanOrEqual(1)

    // 再点一次 = 移除
    await basketBtn.click()
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]').length === 0,
      { timeout: 5000 },
    )
    const idsAfterRemove = await page.evaluate(() => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]'))
    expect(idsAfterRemove.length, '移后 basket-ids 应为 0').toBe(0)

    // 不应弹 error toast
    const hasErrorToast = await page.locator('.el-message--error').count()
    expect(hasErrorToast, '不应弹"系统异常"').toBe(0)
    expect(errorMessages.length, 'console 应无 error').toBe(0)
    void qid // 仅做诊断用
  })
})

test.describe('V1 卡 核心目标 — 0 个 misikt.com 请求', () => {
  test('整会话所有请求都打本地 / api，不调外部', async ({ page }) => {
    const misiktRequests: string[] = []
    page.on('request', req => {
      const u = req.url()
      if (u.includes('misikt.com')) misiktRequests.push(u)
    })

    await loginByApi(page, 'admin')
    await gotoQuestionIndex(page)

    // 点章节 + 筛选触发若干请求
    await page.evaluate(async () => {
      let ctx: any = null
      for (const el of document.querySelectorAll('.el-input')) {
        // @ts-expect-error vue runtime
        let c = el.__vueParentComponent
        while (c) {
          const x = c.setupState || c.ctx
          if (x && x.filter && 'difficulty' in x.filter) { ctx = x; break }
          c = c.parent
        }
        if (ctx) break
      }
      ctx.handleNodeClick({ id: '3072', name: '七年级下册' })
      await new Promise<void>(r => setTimeout(r, 1200))
      ctx.filter.difficulty = 3
      await ctx.onSearch()
      await new Promise<void>(r => setTimeout(r, 1200))
      ctx.onReset()
    })

    expect(misiktRequests, `不应有 misikt.com 请求，实际: ${misiktRequests.join('\n')}`).toEqual([])
  })
})

// J 卡段③ — N+1 反模式删除验证：进题库列表后不应有 N 次 GET /qd/favorite/{id}
test.describe('J 卡段③ — N+1 favorite GET 已删', () => {
  test('题库列表加载只调 /page 1 次，无 N 次 /qd/favorite/{id} GET', async ({ page }) => {
    const favoriteGets: string[] = []
    const pageReqs: string[] = []
    page.on('request', req => {
      const u = req.url()
      // GET /qd/favorite/{id} 是原 loadFavoriteStatus N+1 反模式
      if (req.method() === 'GET' && /\/teacher\/qd\/favorite\/\d+$/.test(u)) {
        favoriteGets.push(u)
      }
      // POST /question/page
      if (req.method() === 'POST' && u.includes('/teacher/question/page')) {
        pageReqs.push(u)
      }
    })

    await loginByApi(page, 'admin')
    await gotoQuestionIndex(page)
    // 等列表渲染完
    await page.waitForSelector('.question-card', { timeout: 10000 }).catch(() => {})
    await page.waitForTimeout(2000) // 给 N+1 一些可能触发的时间窗口

    expect(pageReqs.length, '应至少调 1 次 /page').toBeGreaterThanOrEqual(1)
    expect(favoriteGets.length, `不应有 GET /qd/favorite/{id} 请求（N+1 已删），实际: ${favoriteGets.join('\n')}`).toBe(0)
  })
})
