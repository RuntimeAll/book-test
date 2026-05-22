/**
 * X 卡 freeTag 段③ FE — Mock BE 验证渲染
 *
 * 用 page.route 拦截 /api/* 注入构造数据，验 FreeTagList 在 list / detail 模式下的色循环 + 标签文案。
 * 真接口验证留给后续 BE 起来时跑 x-freetag-fe-smoke.spec.ts。
 *
 * 跑：FE_PORT=5175 pnpm exec playwright test tests/x-freetag-fe-mock.spec.ts --project chromium-local
 */
import { test, expect, Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SHOTS_DIR = path.resolve(__dirname, '..', '..', '..', 'workplace', 'PRD', '2026-05-22-X-freetag-dict', 'smoke')

// 通用 mock：注入一份带 freeTags 的题数据
const MOCK_Q_LIST = {
  total: 3,
  list: [
    {
      id: 33781,
      questionType: 1,
      difficult: 3,
      stemText: '【mock】下列说法正确的是 ... 知识点：数轴 / 相反数 / 绝对值',
      questionKnowledges: [
        { id: 1, questionId: 33781, knowledgeId: 'K001', knowledgeName: '数轴知识' },
      ],
      freeTags: [
        { id: 406, name: '数轴', position: 0 },
        { id: 412, name: '相反数', position: 1 },
        { id: 11, name: '绝对值', position: 2 },
      ],
    },
    {
      id: 33782,
      questionType: 4,
      difficult: 2,
      stemText: '【mock】填空：方程 x+1=0 的解 x=?  4 个 freeTag 测三色循环到第 4 个回到蓝',
      questionKnowledges: [],
      freeTags: [
        { id: 100, name: '一元一次', position: 0 },
        { id: 101, name: '解方程', position: 1 },
        { id: 102, name: '代数', position: 2 },
        { id: 103, name: '基础', position: 3 },
      ],
    },
    {
      id: 33783,
      questionType: 5,
      difficult: 4,
      stemText: '【mock】简答题 — 0 个 freeTag 验 v-if 隐藏',
      questionKnowledges: [],
      freeTags: [],
    },
  ],
  pageNum: 1,
  pageSize: 10,
  pages: 1,
  isFirstPage: true,
  isLastPage: true,
}

const MOCK_Q_33781_DETAIL = {
  ...MOCK_Q_LIST.list[0],
  answerImg: null,
  explainImg: null,
}

const MOCK_PAPER_SOURCE_2798 = {
  paperId: 2798,
  paperName: '【mock】2024 浙江中考数学卷',
  examYear: '2024',
  questions: [
    {
      id: 41001, questionType: 1, difficult: 2,
      stemText: '【mock 卷题 1】带 3 个 freeTag (detail 模式 mini 三色)',
      questionKnowledges: [],
      freeTags: [
        { id: 1, name: '函数', position: 0 },
        { id: 2, name: '图像', position: 1 },
        { id: 3, name: '抛物线', position: 2 },
      ],
    },
    {
      id: 41002, questionType: 4, difficult: 3,
      stemText: '【mock 卷题 2】无 freeTag (不渲染 row)',
      questionKnowledges: [],
      freeTags: [],
    },
  ],
}

const MOCK_LAZY_TREE = [
  { id: '0', title: '【mock】根节点', parentId: null, hasChildren: true, children: [] },
]

async function setupMocks(page: Page) {
  // /auth/* 走 RuoYi envelope {code:200, msg, data}
  await page.route('**/api/auth/login', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ code: 200, msg: 'ok', data: { access_token: 'mock-tok', refresh_token: 'rt', expire_in: 7200, refresh_expire_in: 7200, client_id: 'e5cd7e4891bf95d1d19206ce24a7b32e', scope: null, openid: null } }),
  }))
  // /teacher/* 走 misikt envelope {code:1, message, response}
  const tEnv = (resp: unknown) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 1, message: 'ok', response: resp }) })
  await page.route('**/api/teacher/question/page', (route) => route.fulfill(tEnv(MOCK_Q_LIST)))
  await page.route('**/api/teacher/question/lazyTree', (route) => route.fulfill(tEnv(MOCK_LAZY_TREE)))
  await page.route('**/api/teacher/question/basketNum', (route) => route.fulfill(tEnv(0)))
  await page.route('**/api/teacher/qd/favorite/**', (route) => route.fulfill(tEnv({ favorite: false })))
  await page.route('**/api/teacher/question/select/33781', (route) => route.fulfill(tEnv(MOCK_Q_33781_DETAIL)))
  await page.route('**/api/teacher/qd/note/**', (route) => route.fulfill(tEnv(null)))
  await page.route('**/api/teacher/qd/papers/**', (route) => route.fulfill(tEnv([])))
  await page.route('**/api/teacher/paper/source/2798', (route) => route.fulfill(tEnv(MOCK_PAPER_SOURCE_2798)))
}

async function fakeLogin(page: Page) {
  await page.goto('/#/login')
  await page.evaluate(() => {
    localStorage.setItem('book-ui:auth', JSON.stringify({
      scope: null,
      openid: null,
      access_token: 'mock-tok',
      refresh_token: 'rt',
      expire_in: 7200,
      refresh_expire_in: 7200,
      client_id: 'e5cd7e4891bf95d1d19206ce24a7b32e',
    }))
  })
  await page.reload()
}

test.describe('X 卡 段③ FE Mock — 视觉 + 文案验证', () => {

  test('1. question/index — list 模式色循环 + 33781 三标签', async ({ page }) => {
    await setupMocks(page)
    await fakeLogin(page)
    await page.goto('/#/question/index')
    await page.waitForSelector('.question-card', { timeout: 15000 })
    await page.waitForTimeout(1500)

    // 33781 卡片：3 个 freeTag (数轴/相反数/绝对值)
    const items = page.locator('.question-card').first().locator('.free-tag-list .free-tag-item')
    const cnt = await items.count()
    console.log(`[mock] 卡 33781 freeTag count = ${cnt}`)
    expect(cnt).toBe(3)
    const texts = await items.allTextContents()
    expect(texts.map(s => s.trim())).toEqual(['数轴', '相反数', '绝对值'])

    // 验色循环：el-tag 用 type 类名
    // position 0 → default (无 type 类) + default size (medium)
    // position 1 → success
    // position 2 → warning
    const cls0 = await items.nth(0).getAttribute('class')
    const cls1 = await items.nth(1).getAttribute('class')
    const cls2 = await items.nth(2).getAttribute('class')
    console.log(`[mock] tag classes: 0="${cls0}" / 1="${cls1}" / 2="${cls2}"`)
    // list 模式：
    //   position 0 → CYCLE[idx] N/A，type=''（el-tag 实际渲染 primary 蓝），size=default
    //   position 1 → (1-1)%3=0 → CYCLE[0]='' → primary 蓝，size=small
    //   position 2 → (2-1)%3=1 → CYCLE[1]='success' → 绿，size=small
    //   position 3 → (3-1)%3=2 → CYCLE[2]='warning' → 橙，size=small
    // el-tag type=''/'primary' 都解析为 .el-tag--primary 类（不带 --success/--warning/--info/--danger 即蓝）
    expect(cls0).toMatch(/el-tag--primary/)   // 蓝
    expect(cls0).not.toMatch(/el-tag--small/) // medium / default
    expect(cls1).toMatch(/el-tag--primary/)   // 蓝
    expect(cls1).toMatch(/el-tag--small/)
    expect(cls2).toMatch(/el-tag--success/)   // 绿
    expect(cls2).toMatch(/el-tag--small/)

    // 第 2 卡（4 个 tag 循环）：position 3 → (3-1)%3=2 → warning（橙）
    const card2Items = page.locator('.question-card').nth(1).locator('.free-tag-list .free-tag-item')
    const card2Cnt = await card2Items.count()
    expect(card2Cnt).toBe(4)
    const cls2_3 = await card2Items.nth(3).getAttribute('class')
    console.log(`[mock] 卡 33782 第 4 tag (position 3) class = "${cls2_3}"`)
    expect(cls2_3).toMatch(/el-tag--warning/)

    // 第 3 卡（0 个 tag）— FreeTagList v-if=false，应无 .free-tag-list
    const card3Has = await page.locator('.question-card').nth(2).locator('.free-tag-list').count()
    expect(card3Has).toBe(0)

    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-mock-01-list.png'), fullPage: true })
  })

  test('2. question/detail/33781 — detail 模式全 mini，position % 3', async ({ page }) => {
    await setupMocks(page)
    await fakeLogin(page)
    await page.goto('/#/question/detail/33781')
    await page.waitForSelector('.free-tag-list-inline, .detail-main', { timeout: 15000 })
    await page.waitForTimeout(1500)
    const items = page.locator('.free-tag-list-inline .free-tag-item')
    const cnt = await items.count()
    console.log(`[mock] detail 33781 freeTag count = ${cnt}`)
    expect(cnt).toBe(3)
    const texts = await items.allTextContents()
    expect(texts.map(s => s.trim())).toEqual(['数轴', '相反数', '绝对值'])
    // detail 模式全 small + position % 3 循环
    // position 0 → CYCLE[0]='' → primary 蓝
    // position 1 → CYCLE[1]='success' → 绿
    // position 2 → CYCLE[2]='warning' → 橙
    for (let i = 0; i < 3; i++) {
      const cls = await items.nth(i).getAttribute('class')
      expect(cls, `idx ${i}`).toMatch(/el-tag--small/)
    }
    expect(await items.nth(0).getAttribute('class')).toMatch(/el-tag--primary/)
    expect(await items.nth(1).getAttribute('class')).toMatch(/el-tag--success/)
    expect(await items.nth(2).getAttribute('class')).toMatch(/el-tag--warning/)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-mock-02-detail.png'), fullPage: true })
  })

  test('3. papers/source/2798 — detail 模式 + 第 1 题 3 tags / 第 2 题 0 tag', async ({ page }) => {
    await setupMocks(page)
    await fakeLogin(page)
    await page.goto('/#/papers/source/2798')
    await page.waitForSelector('.source-question-card', { timeout: 15000 })
    await page.waitForTimeout(1500)
    const cards = await page.locator('.source-question-card').count()
    expect(cards).toBe(2)
    // 第 1 张：3 tag
    const c1 = page.locator('.source-question-card').nth(0).locator('.free-tag-list .free-tag-item')
    expect(await c1.count()).toBe(3)
    const c1Texts = await c1.allTextContents()
    expect(c1Texts.map(s => s.trim())).toEqual(['函数', '图像', '抛物线'])
    // 第 2 张：0 tag → 无 free-tag-list
    const c2Cnt = await page.locator('.source-question-card').nth(1).locator('.free-tag-list').count()
    expect(c2Cnt).toBe(0)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-mock-03-papers-source.png'), fullPage: true })
  })

  test('4. QuestionDetailDrawer — drawer 在 index.vue 已注释（第 12 波路由替代），仅静态截 list', async ({ page }) => {
    await setupMocks(page)
    await fakeLogin(page)
    await page.goto('/#/question/index')
    await page.waitForSelector('.question-card', { timeout: 15000 })
    await page.waitForTimeout(1500)
    // drawer 不挂载，按"详情"按钮直接 router.push(/question/detail/:id)
    // 抽屉位 N/A — 但 QuestionDetailDrawer.vue 文件内已替换 freeTag 字符串 → FreeTagList 组件 (代码静态正确)
    await page.screenshot({ path: path.join(SHOTS_DIR, '03-fe-mock-04-drawer-na.png'), fullPage: true })
  })
})
