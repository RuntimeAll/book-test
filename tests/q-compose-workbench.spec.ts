/**
 * Q 卡（组卷工作台）回归测试套
 *
 * 覆盖：
 *   T1. /question/compose 路由可达（teacher 登录态进入工作台 + 页面标题渲染）
 *   T2. createExamPaper API 200 — 直接 fetch /teacher/exam/paper/create 拿 paperId
 *   T3. 创建成功跳 /papers/source/{id} 卷详情（端到端）
 *   T4. FAB 在 /question/compose 不显示（接 P-2 白名单）
 *
 * 跑前置：
 *   1. BE 必须起：cd codeSpace/book-server/ruoyi-admin && mvn spring-boot:run
 *   2. DB 已落 U 卡段① 配置（teacher001 / role_key='teacher'）
 *   3. 题库内有 ≥ 2 题（V1 ETL 已就位 1.6w 题）
 *
 * 跑：
 *   pnpm test:q                  # 默认 headless
 *   pnpm test:q:headed           # 看浏览器
 */
import { test, expect, Page } from '@playwright/test'

const TEACHER_USER = 'teacher001'
const TEACHER_PWD = '666666'
const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'

/**
 * 登录 — 走 /auth/login fetch 拿 token 注入 localStorage。
 * caller 后续需 reload 让 pinia store init 读到 LS。
 */
async function loginAsTeacher(page: Page): Promise<string> {
  await page.goto('/#/login')
  await page.waitForLoadState('domcontentloaded')

  const token = await page.evaluate(async ({ user, pwd, cid }) => {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user,
        password: pwd,
        clientId: cid,
        grantType: 'password',
        tenantId: '000000',
      }),
    })
    const j = await resp.json()
    const data = j.data || {}
    const auth = {
      scope: data.scope ?? null,
      openid: data.openid ?? null,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expire_in: data.expire_in,
      refresh_expire_in: data.refresh_expire_in,
      client_id: cid,
    }
    localStorage.setItem('book-ui:auth', JSON.stringify(auth))
    return data.access_token as string
  }, { user: TEACHER_USER, pwd: TEACHER_PWD, cid: CLIENT_ID })

  expect(token, '登录失败 — teacher001 账号是否存在？BE 8080 是否起？').toBeTruthy()
  return token
}

/**
 * 通过 fetch 拿题库前 N 题的 id（不走 UI，节省时间）。
 */
async function fetchQuestionIds(page: Page, token: string, count: number): Promise<number[]> {
  const ids = await page.evaluate(async ({ tk, n }) => {
    const resp = await fetch('/api/teacher/question/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tk}`,
        clientid: 'e5cd7e4891bf95d1d19206ce24a7b32e',
      },
      body: JSON.stringify({ pageIndex: 1, pageSize: n }),
    })
    const j = await resp.json()
    const list = j?.response?.list || j?.data?.list || []
    return (list as Array<{ id: number }>).slice(0, n).map(q => q.id)
  }, { tk: token, n: count })
  expect(ids.length, '题库返题数不足 — V1 ETL 是否就位？').toBeGreaterThanOrEqual(count)
  return ids
}

/**
 * 把题目 id 写进 LS basket（跳过 UI 加题，省时）。
 */
async function seedBasketLS(page: Page, ids: number[]) {
  await page.evaluate((arr) => {
    localStorage.setItem('book-ui:basket-ids', JSON.stringify(arr))
    const cache = arr.map(id => [id, {
      id,
      questionType: 1,
      difficult: null,
      stemImg: null,
      stemText: `测试题 #${id}`,
    }])
    localStorage.setItem('book-ui:basket-cache', JSON.stringify(cache))
  }, ids)
}

test.describe('Q 卡 · 组卷工作台', () => {

  test('T1. /question/compose 路由可达 — 工作台页面渲染', async ({ page }) => {
    await loginAsTeacher(page)
    // 必须 reload 让 pinia store init 拿 LS token，否则 router guard 重定向回 /login（U 卡踩坑沉淀）
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.goto('/#/question/compose')
    await page.waitForLoadState('domcontentloaded')

    // 标题 "组卷工作台" 应可见
    await expect(page.locator('.page-title')).toContainText('组卷工作台')
    // 试卷名称输入框默认 "未命名草稿"
    await expect(page.locator('.name-input input').first()).toHaveValue('未命名草稿')
  })

  test('T2. createExamPaper API 200 — 拿 paperId', async ({ page }) => {
    const token = await loginAsTeacher(page)
    const questionIds = await fetchQuestionIds(page, token, 2)

    const result = await page.evaluate(async ({ tk, qids }) => {
      const resp = await fetch('/api/teacher/exam/paper/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tk}`,
          clientid: 'e5cd7e4891bf95d1d19206ce24a7b32e',
        },
        body: JSON.stringify({
          name: `Q 卡 E2E 测试卷 ${Date.now()}`,
          questionIds: qids,
        }),
      })
      return {
        status: resp.status,
        body: await resp.json(),
      }
    }, { tk: token, qids: questionIds })

    expect(result.status, 'HTTP 200').toBe(200)
    // /teacher/* 走 MisiktEnvelopeAdvice envelope { code:1, message:"成功", response: {paperId, questionCount} }
    expect(result.body?.code, 'envelope code=1 表示成功').toBe(1)
    expect(result.body?.response?.paperId, '返新 paperId').toBeTruthy()
    expect(result.body?.response?.questionCount, '题目数 = 2').toBe(2)
  })

  test('T3. 创建成功跳 /papers/source/{id} 卷详情', async ({ page }) => {
    const token = await loginAsTeacher(page)
    const questionIds = await fetchQuestionIds(page, token, 2)

    // 1. 进工作台前先 seed LS basket
    await page.goto('/#/question/index')
    await page.waitForLoadState('domcontentloaded')
    await seedBasketLS(page, questionIds)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // 2. 跳 compose
    await page.goto('/#/question/compose')
    await page.waitForLoadState('domcontentloaded')

    // 3. 改试卷名
    const uniqueName = `Q_E2E_${String(Date.now()).slice(-8)}`
    const nameInput = page.locator('.name-input input').first()
    await nameInput.fill(uniqueName)

    // 4. 点 "创建试卷"
    await page.locator('button:has-text("创建试卷")').click()

    // 5. 等 URL 跳到 /papers/source/{id}
    await page.waitForURL(/\/papers\/source\/\d+/, { timeout: 10000 })
    const url = page.url()
    expect(url, '已跳卷详情').toMatch(/\/papers\/source\/\d+/)

    // 6. LS basket 应已清空
    const basketIds = await page.evaluate(() => {
      const raw = localStorage.getItem('book-ui:basket-ids')
      return raw ? JSON.parse(raw) : []
    })
    expect(basketIds.length, '试题栏清空').toBe(0)
  })

  test('T4. FAB 在 /question/compose 不显示（接 P-2 白名单）', async ({ page }) => {
    await loginAsTeacher(page)
    // reload 让 store init 拿 LS token，避免 router guard 重定向 — 否则在 /login 也没 FAB 是伪 PASS
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await page.goto('/#/question/compose')
    await page.waitForLoadState('domcontentloaded')

    // 先确认真在工作台（防伪 PASS）
    await expect(page.locator('.page-title')).toContainText('组卷工作台')
    // /question/compose 应被排除 FAB 白名单 — 工作台自身已展示题目，FAB 嵌套冗余
    await expect(page.locator('.basket-fab')).toHaveCount(0)
  })
})
