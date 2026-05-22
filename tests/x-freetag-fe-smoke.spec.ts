/**
 * X 卡 freeTag 字典化 · 段③ FE smoke
 *
 * 跑前置：BE :8080 已起（mvn spring-boot:run），admin/admin123 存在。
 * 跑：
 *   pnpm exec playwright test tests/x-freetag-fe-smoke.spec.ts --project chromium-local
 */
import { test, expect, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SHOTS_DIR = path.resolve(__dirname, '..', '..', '..', 'workplace', 'PRD', '2026-05-22-X-freetag-dict', 'smoke')

const ADMIN_USER = 'admin'
const ADMIN_PWD = 'admin123'
const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'
const Q_ID = 33781  // BE 已对账：freeTags = [{406,数轴,0},{412,相反数,1},{11,绝对值,2}]
const PAPER_ID = 2798

async function loginAsAdmin(page: Page): Promise<string> {
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
  }, { user: ADMIN_USER, pwd: ADMIN_PWD, cid: CLIENT_ID })
  expect(token, '登录失败 — BE 8080 起了吗？admin 账号在吗？').toBeTruthy()
  return token
}

test.describe('X 卡 freeTag 字典化 · 段③ FE smoke', () => {

  test('1. 题库列表 question/index — list 模式：position 0 medium + 后续 mini 三色循环', async ({ page }) => {
    await loginAsAdmin(page)
    await page.reload()
    await page.goto('/#/question/index')
    await page.waitForSelector('.el-select, .question-list, .el-empty', { timeout: 20000 })
    // 等列表至少有 1 张卡 + freeTag 数据回来
    await page.waitForSelector('.question-card', { timeout: 20000 })
    await page.waitForTimeout(2500)
    // 至少有 1 个 free-tag-list 出现（页面 10 条里大概率覆盖率 >0）
    const ftCount = await page.locator('.free-tag-list .free-tag-item').count()
    console.log(`[freetag] list 页 .free-tag-item 数量 = ${ftCount}`)
    expect(ftCount).toBeGreaterThan(0)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-01-list.png'), fullPage: true })
  })

  test('2. 题目详情独立页 question/detail/33781 — detail 模式 + 3 个 tag (数轴/相反数/绝对值)', async ({ page }) => {
    await loginAsAdmin(page)
    await page.reload()
    await page.goto(`/#/question/detail/${Q_ID}`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000)
    // 期望命中 3 个 free-tag-item
    const items = page.locator('.free-tag-list .free-tag-item')
    const cnt = await items.count()
    console.log(`[freetag] q.${Q_ID} 详情页 free-tag-item count = ${cnt}`)
    expect(cnt).toBeGreaterThanOrEqual(3)
    const texts = await items.allTextContents()
    console.log(`[freetag] q.${Q_ID} tag 文案 = ${JSON.stringify(texts)}`)
    expect(texts.map(s => s.trim())).toEqual(expect.arrayContaining(['数轴', '相反数', '绝对值']))
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-02-detail.png'), fullPage: true })
  })

  test('3. 抽屉 QuestionDetailDrawer — list 卡片"详情"按钮已替换为路由，跳过；改用列表上首张卡片 hover 截图', async ({ page }) => {
    // 抽屉组件在 index.vue 已注释（第十二波路由替代）— 本测仅取列表整页第 2 张截图作为"抽屉位 N/A"凭证
    await loginAsAdmin(page)
    await page.reload()
    await page.goto('/#/question/index')
    await page.waitForSelector('.question-card', { timeout: 20000 })
    await page.waitForTimeout(2500)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-03-drawer-na.png'), fullPage: true })
  })

  test('4. 卷库原卷预览 papers/source/2798 — detail 模式：24 题至少 N 题有 freeTags', async ({ page }) => {
    await loginAsAdmin(page)
    await page.reload()
    await page.goto(`/#/papers/source/${PAPER_ID}`)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('.source-question-card, .source-empty', { timeout: 20000 })
    await page.waitForTimeout(3000)
    const ftItems = await page.locator('.free-tag-list .free-tag-item').count()
    const cards = await page.locator('.source-question-card').count()
    console.log(`[freetag] 原卷 ${PAPER_ID} 卡片数 = ${cards} / free-tag-item 总数 = ${ftItems}`)
    expect(cards).toBeGreaterThan(0)
    expect(ftItems).toBeGreaterThan(0)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-04-papers-source.png'), fullPage: true })
  })
})
