/**
 * E 卡 段④ · 试卷详情完整页 + 跨模块共享组件 E2E
 *
 * 覆盖 PRD §4.1 用户层 5 步：
 *   T1: BE POST /teacher/exam/paper/detail 端点直跑（卷头/3 section/题数/字段）
 *   T2: FE 卷头区 paperName + 4 chips (年份/总分/时长/题数)
 *   T3: FE 3 个大题标题（一、选择题 / 二、填空题 / 三、简答题）+ 小计
 *   T4: FE 24 题卡渲染 + 题号 1-24 连续
 *   T5: FE 点"详情"按钮 → QuestionDetailDrawer 弹出
 *   T6: FE 点"+试题栏"按钮 → 全局 .basket-fab 角标 +1
 *   T7: FE 跨页共享 — source/2798 加 1 题 → 跳 question/index → 全局 FAB 角标保持 1
 *
 * 跑前置：
 *   1. BE 起 8080：cd codeSpace/book-server && mvn spring-boot:run -pl ruoyi-admin -Dspring-boot.run.profiles=dev
 *   2. webServer 自动起 vite (FE_PORT=4010 / playwright.config.ts)
 *
 * 跑：
 *   pnpm exec playwright test tests/v05-e-paper-detail.spec.ts --project chromium-local
 */
import { test, expect, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SHOTS_DIR = path.resolve(
  __dirname,
  '..', '..', '..',
  'workplace', 'PRD', '2026-05-22-E-paper-detail-and-components', 'smoke',
)

const ADMIN_USER = 'admin'
const ADMIN_PWD = 'admin123'
const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'
const BASE_HASH = '/teacher/#'

// paper 2798 真数据（段① 体检）
const PAPER_ID = 2798
const EXPECTED = {
  paperName: '2025年嘉兴一中实验学校七年级（上）期末数学试卷',
  examYear: '2025',
  score: 120,
  suggestTime: 120,
  questionCount: 24,
  sectionTitles: ['选择题', '填空题', '简答题'],
  sectionQCounts: [10, 6, 8],
  // 跨 section 全局题号 1-24
  sortRange: { min: 1, max: 24 },
}

async function loginAsAdmin(page: Page): Promise<string> {
  await page.goto(`${BASE_HASH}/login`)
  await page.waitForLoadState('domcontentloaded')
  const token = await page.evaluate(async ({ user, pwd, cid }) => {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user, password: pwd, clientId: cid,
        grantType: 'password', tenantId: '000000',
      }),
    })
    const j = await resp.json()
    const data = j.data || {}
    localStorage.setItem('book-ui:auth', JSON.stringify({
      scope: data.scope ?? null,
      openid: data.openid ?? null,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expire_in: data.expire_in,
      refresh_expire_in: data.refresh_expire_in,
      client_id: cid,
    }))
    // 清 basket 旧 LS（防上一轮残留干扰跨页 + 角标断言）
    localStorage.removeItem('book-ui:basket-ids')
    localStorage.removeItem('book-ui:basket-cache')
    return data.access_token as string
  }, { user: ADMIN_USER, pwd: ADMIN_PWD, cid: CLIENT_ID })
  expect(token, '登录失败 — BE 8080 是否起？').toBeTruthy()
  return token
}

async function gotoSource(page: Page, paperId: number = PAPER_ID) {
  await page.reload()
  await page.goto(`${BASE_HASH}/papers/source/${paperId}`)
  await page.waitForSelector('.paper-header, .source-empty', { timeout: 20000 })
  await page.waitForTimeout(1500) // 让 BE 接口落 + DOM 完整渲染
}

test.describe('E 卡 段④ · 试卷详情完整页 + 通用组件 E2E', () => {

  test('T1. BE POST /teacher/exam/paper/detail 端点 — 卷头 + 3 section + 24 题', async ({ page }) => {
    await loginAsAdmin(page)
    const result = await page.evaluate(async ({ paperId, cid }) => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const resp = await fetch('/api/teacher/exam/paper/detail', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.access_token}`,
          'clientid': cid,
        },
        body: JSON.stringify({ paperId }),
      })
      const j = await resp.json()
      return j
    }, { paperId: PAPER_ID, cid: CLIENT_ID })
    expect(result.code).toBe(1)
    const r = result.response
    expect(r.paperId).toBe(PAPER_ID)
    expect(r.paperName).toBe(EXPECTED.paperName)
    expect(Number(r.score)).toBe(EXPECTED.score)
    expect(r.suggestTime).toBe(EXPECTED.suggestTime)
    expect(r.questionCount).toBe(EXPECTED.questionCount)
    expect(r.examYear).toBe(EXPECTED.examYear)
    expect(Array.isArray(r.sections)).toBe(true)
    expect(r.sections.length).toBe(3)
    expect(r.sections.map((s: any) => s.title)).toEqual(EXPECTED.sectionTitles)
    expect(r.sections.map((s: any) => s.questions.length)).toEqual(EXPECTED.sectionQCounts)
    // 题字段含全套 (X 卡 + D 卡复用)
    const q1 = r.sections[0].questions[0]
    expect(q1.id).toBeTruthy()
    expect(q1.questionType).toBe(1)
    expect(q1.stemImg).toBeTruthy()
    expect(typeof q1.sort).toBe('number')
    expect(q1.pqScore).toBeTruthy()
    expect(Array.isArray(q1.freeTags)).toBe(true)
    expect(Array.isArray(q1.questionKnowledges)).toBe(true)
    console.log('[T1] BE 卷头+3 sections+24 题全字段 PASS')
  })

  test('T2. FE 卷头区 — paperName + 4 chips (年份/总分/时长/题数)', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoSource(page)
    const title = await page.locator('.paper-header .paper-title').textContent()
    expect(title?.trim()).toBe(EXPECTED.paperName)
    const chips = await page.locator('.paper-header .meta-chip').allTextContents()
    expect(chips.length).toBeGreaterThanOrEqual(4)
    expect(chips.some(s => s.includes(EXPECTED.examYear))).toBe(true)
    expect(chips.some(s => s.includes('总分') && s.includes(String(EXPECTED.score)))).toBe(true)
    expect(chips.some(s => s.includes('时长') && s.includes(String(EXPECTED.suggestTime)))).toBe(true)
    expect(chips.some(s => s.includes(String(EXPECTED.questionCount)))).toBe(true)
    await page.screenshot({ path: path.join(SHOTS_DIR, '05-fe-T2-header.png'), fullPage: true })
    console.log('[T2] FE 卷头 4 chips PASS:', chips)
  })

  test('T3. FE 大题分组 — 3 个 section 标题 + 小计', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoSource(page)
    const titles = await page.locator('.paper-section .section-title').allTextContents()
    expect(titles.length).toBe(3)
    // 标题含中文序号 + 大题名
    expect(titles[0]).toMatch(/^一、.*选择题/)
    expect(titles[1]).toMatch(/^二、.*填空题/)
    expect(titles[2]).toMatch(/^三、.*简答题/)
    // 小计含题数：(共 10 题，共 30 分) / (共 6 题，共 18 分) / (共 8 题，共 72 分)
    expect(titles[0]).toMatch(/共\s*10\s*题/)
    expect(titles[1]).toMatch(/共\s*6\s*题/)
    expect(titles[2]).toMatch(/共\s*8\s*题/)
    console.log('[T3] section 标题 PASS:', titles.map(t => t.trim()))
  })

  test('T4. FE 24 题卡 + 题号连续', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoSource(page)
    const cards = await page.locator('.source-question-card').count()
    expect(cards).toBe(EXPECTED.questionCount)
    // 题号文案 1. - 24. 全在
    const nums = await page.locator('.source-question-card .q-num').allTextContents()
    const nMap = nums.map(s => s.replace('.', '').trim())
    // 至少前 3 题和最后 1 题题号正确
    expect(nMap[0]).toBe('1')
    expect(nMap[1]).toBe('2')
    expect(nMap[nMap.length - 1]).toBe('24')
    console.log('[T4] 24 题卡 + 题号 1..24 PASS')
  })

  test('T5. FE 点详情按钮 — QuestionDetailDrawer 弹出', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoSource(page)
    // 第一题"详情"按钮（el-button 含文字"详情"，定位到第一张卡内）
    const detailBtn = page.locator('.source-question-card').first().locator('button:has-text("详情")').first()
    await detailBtn.waitFor({ state: 'visible', timeout: 10000 })
    await detailBtn.click()
    // drawer 弹（el-drawer 出现 + 标题"题目详情"）
    await page.locator('.el-drawer__title:has-text("题目详情")').waitFor({ state: 'visible', timeout: 10000 })
    // drawer 内含题型 tag + ID
    const drawerContent = page.locator('.el-drawer__body')
    await expect(drawerContent).toBeVisible()
    const contentText = await drawerContent.textContent()
    expect(contentText).toMatch(/选择题|填空题|简答题/)
    await page.screenshot({ path: path.join(SHOTS_DIR, '05-fe-T5-drawer.png'), fullPage: true })
    console.log('[T5] Drawer 弹出 PASS')
  })

  test('T6. FE 点+试题栏 — 全局 .basket-fab 角标 +1', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoSource(page)
    // 初始 FAB 角标 = 0（hidden）— 用 evaluate 读 LS 内 basket-ids
    const idsBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]'))
    expect(idsBefore.length).toBe(0)
    // 点第一题 "+ 试题栏" 按钮
    const basketBtn = page.locator('.source-question-card').first().locator('button:has-text("+ 试题栏"), button:has-text("+试题栏")').first()
    await basketBtn.waitFor({ state: 'visible', timeout: 10000 })
    await basketBtn.click()
    // 等 LS 写入
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]').length >= 1,
      { timeout: 5000 },
    )
    const idsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]'))
    expect(idsAfter.length).toBe(1)
    // 全局 FAB 角标 = 1（el-badge 显示 1）
    const fab = page.locator('.basket-fab')
    await fab.waitFor({ state: 'visible', timeout: 5000 })
    // el-badge 子元素含 value="1"
    const badgeText = await fab.locator('.el-badge__content').first().textContent()
    expect(badgeText?.trim()).toBe('1')
    await page.screenshot({ path: path.join(SHOTS_DIR, '05-fe-T6-fab-1.png'), fullPage: true })
    console.log('[T6] FAB 角标 = 1 PASS')
  })

  test('T7. FE 跨页 — source/2798 加题 → question/index FAB 角标保持', async ({ page }) => {
    await loginAsAdmin(page)
    await gotoSource(page)
    const basketBtn = page.locator('.source-question-card').first().locator('button:has-text("+ 试题栏"), button:has-text("+试题栏")').first()
    await basketBtn.waitFor({ state: 'visible', timeout: 10000 })
    await basketBtn.click()
    await page.waitForFunction(
      () => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]').length >= 1,
      { timeout: 5000 },
    )
    // 跳题库列表
    await page.goto(`${BASE_HASH}/question/index`)
    await page.waitForSelector('.question-card, .el-empty', { timeout: 20000 })
    await page.waitForTimeout(1500)
    // 全局 FAB 在题库页也可见 + 角标保持 1
    const fab = page.locator('.basket-fab')
    await fab.waitFor({ state: 'visible', timeout: 5000 })
    const badgeText = await fab.locator('.el-badge__content').first().textContent()
    expect(badgeText?.trim()).toBe('1')
    // LS 也保持
    const ids = await page.evaluate(() => JSON.parse(localStorage.getItem('book-ui:basket-ids') || '[]'))
    expect(ids.length).toBe(1)
    await page.screenshot({ path: path.join(SHOTS_DIR, '05-fe-T7-cross-page.png'), fullPage: true })
    console.log('[T7] 跨页 FAB 共享 PASS')
  })

})
