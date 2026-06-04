/**
 * Q' 卡（试卷预览模态 + LaTeX + jsPDF 导出）回归测试套
 *
 * 覆盖：
 *   T1. 工作台"导出 PDF"按钮去 disabled — 可点击打开预览模态
 *   T2. listByIds API 200 + 字段全 — 直接 fetch /teacher/question/list?ids= 验响应
 *   T3. 模态打开后题目渲染 + freeTag 分组 + 答案/解析 checkbox 可切换
 *   T4. 点"导出 PDF"触发下载（断 download 事件 / 不强求验 PDF 内容）
 *
 * 跑前置：
 *   1. BE 必须起：cd codeplace-A/book-server/ruoyi-admin && mvn spring-boot:run
 *   2. DB 已落 U 卡段① 配置（teacher001 / role_key='teacher'）
 *   3. 题库内有 ≥ 5 有 freeTag 的题（MCP 已验 id 1045-1054 可用）
 *
 * 跑：
 *   pnpm test:q-prime              # 默认 headless
 *   pnpm test:q-prime:headed       # 看浏览器（PDF download 行为需 headed 验）
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD, CLIENT_ID } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// local-only: 试卷预览/导出 PDF 为写操作
test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

// MCP 已验 — 这 5 个 id 都有 freeTag（含多 tag）
const TEST_IDS = [1045, 1046, 1047, 1052, 1054]


/**
 * 把题目 id 写进 LS basket（跳过 UI 加题，省时）— 复用 Q 卡 spec 模式
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

test.describe(`Q' 卡 · 试卷预览模态 + LaTeX + PDF`, () => {

  // 现行契约（PRD-A-007）：/question/compose 已重定向到 /papers/workbench。
  // workbench.vue 的导出按钮文案是"下载 PDF"（不是"导出 PDF"），位于右栏底部固定控制台。
  // workbench 无 .page-title，顶栏是 .workbench-topbar + 内联标题输入框。
  test('T1. 工作台"下载 PDF"按钮去 disabled — 可点击打开预览模态', async ({ page }) => {
    await loginByApi(page, 'teacher')
    // loginByApi 已完成 reload，直接 goto
    await page.goto('/#/question/index')
    await page.waitForLoadState('domcontentloaded')
    await seedBasketLS(page, TEST_IDS)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // /question/compose 已重定向到 /papers/workbench（PRD-A-007 路由收敛）
    await page.goto('/#/question/compose')
    await page.waitForLoadState('domcontentloaded')
    // 重定向后应落在 /papers/workbench
    await page.waitForURL(/#\/papers\/workbench/, { timeout: 5000 })

    // 工作台顶栏（workbench 无 .page-title，标题是内联输入框）
    await expect(page.locator('.workbench-topbar')).toBeVisible()

    // 下载 PDF 按钮可点（workbench 右栏底部固定控制台，basket 有题时不 disabled）
    const exportBtn = page.locator('button:has-text("下载 PDF")')
    await expect(exportBtn).toBeVisible({ timeout: 5000 })
    await expect(exportBtn).toBeEnabled()

    // 点击打开模态
    await exportBtn.click()

    // 模态可见（el-dialog 容器）
    await expect(page.locator('.paper-preview-dialog, .el-dialog').first()).toBeVisible({ timeout: 5000 })
  })

  test('T2. listByIds API 200 + 字段全（含 freeTags / answer / explain）', async ({ page }) => {
    const token = await loginByApi(page, 'teacher')

    const result = await page.evaluate(async ({ tk, ids, cid }) => {
      const resp = await fetch(`/api/teacher/question/list?ids=${ids.join(',')}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tk}`,
          clientid: cid,
        },
      })
      return {
        status: resp.status,
        body: await resp.json(),
      }
    }, { tk: token, ids: TEST_IDS, cid: CLIENT_ID })

    expect(result.status, 'HTTP 200').toBe(200)
    // /teacher/* 走 MisiktEnvelopeAdvice envelope { code:1, message:"成功", response: [...] }
    expect(result.body?.code, 'envelope code=1').toBe(1)
    const list = result.body?.response
    expect(Array.isArray(list), '响应是数组').toBe(true)
    expect(list.length, `${TEST_IDS.length} 题全返`).toBe(TEST_IDS.length)

    // 字段全 — 抽第一题验
    const q0 = list[0]
    expect(q0.id, 'id 字段').toBeTruthy()
    expect(q0.questionType, 'questionType 字段').toBeDefined()
    expect(q0.freeTags, 'freeTags 字段是数组').toBeDefined()
    expect(Array.isArray(q0.freeTags), 'freeTags 是数组').toBe(true)
    // questionKnowledges / answer / explain 字段存在（值可能为 null/empty）
    expect('questionKnowledges' in q0, 'questionKnowledges 字段存在').toBe(true)
    expect('answer' in q0, 'answer 字段存在').toBe(true)
    expect('explain' in q0, 'explain 字段存在').toBe(true)

    // 顺序保持 — 第 i 个返回应等于第 i 个入参 id
    for (let i = 0; i < TEST_IDS.length; i++) {
      expect(list[i].id, `第 ${i} 个保序`).toBe(TEST_IDS[i])
    }
  })

  test('T3. 模态打开后题目渲染 + 答案/解析 checkbox 切换', async ({ page }) => {
    await loginByApi(page, 'teacher')
    // loginByApi 已完成 reload，直接 goto
    await page.goto('/#/question/index')
    await page.waitForLoadState('domcontentloaded')
    await seedBasketLS(page, TEST_IDS)
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // /question/compose 已重定向到 /papers/workbench（PRD-A-007 路由收敛）
    await page.goto('/#/question/compose')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForURL(/#\/papers\/workbench/, { timeout: 5000 })

    // 按钮文案已改为"下载 PDF"
    await page.locator('button:has-text("下载 PDF")').click()

    // 模态打开 + 等数据加载完（响应 fetch 后题目渲染出来）
    const dialog = page.locator('.paper-preview-dialog, .el-dialog').first()
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // 题目区域出现 ≥ 1 个题（5 题入栏，全有 freeTag 应至少 1 组）
    await expect(dialog.locator('.pp-question').first())
      .toBeVisible({ timeout: 8000 })

    // 答案 checkbox 切换（el-checkbox 渲染为 label.el-checkbox 包 input）
    const answerCheckboxLabel = dialog.locator('label.el-checkbox:has-text("显示答案")')
    await expect(answerCheckboxLabel).toBeVisible()
    await answerCheckboxLabel.click()
    // 点击后 input checked 应为 true
    const answerInput = answerCheckboxLabel.locator('input[type="checkbox"]')
    await expect(answerInput).toBeChecked()
    // 再点击取消
    await answerCheckboxLabel.click()
    await expect(answerInput).not.toBeChecked()
  })

  test('T4. 点"导出 PDF"触发下载（download 事件）', async ({ page }) => {
    // 监听 console / pageerror 协助 debug
    const consoleErrors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push(`[${msg.type()}] ${msg.text()}`)
      }
    })
    page.on('pageerror', e => consoleErrors.push(`[pageerror] ${e.message}`))

    await loginByApi(page, 'teacher')
    // loginByApi 已完成 reload，直接 goto
    await page.goto('/#/question/index')
    await page.waitForLoadState('domcontentloaded')
    // T4 用更少的题 + 不带图测试，避免 OSS CORS / 大图 + 30s download 卡死
    await seedBasketLS(page, [TEST_IDS[0], TEST_IDS[1]])
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // /question/compose 已重定向到 /papers/workbench（PRD-A-007 路由收敛）
    await page.goto('/#/question/compose')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForURL(/#\/papers\/workbench/, { timeout: 5000 })

    // 按钮文案已改为"下载 PDF"
    await page.locator('button:has-text("下载 PDF")').click()
    const dialog = page.locator('.paper-preview-dialog, .el-dialog').first()
    await expect(dialog).toBeVisible({ timeout: 5000 })

    // 等题目渲染完 + MathJax + 图片加载
    await expect(dialog.locator('.pp-question').first())
      .toBeVisible({ timeout: 10000 })
    await page.waitForTimeout(3000)

    // 点模态底部"导出 PDF"按钮（dialog 内 + primary type 唯一）
    const downloadBtn = dialog.locator('button.el-button--primary:has-text("导出")').first()
    await expect(downloadBtn).toBeEnabled()

    // 监听 download 事件 — 给到 60s 因为 html2canvas + jsPDF + OSS 图 + MathJax 耗时
    const downloadPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null)
    await downloadBtn.click()
    const download = await downloadPromise

    if (!download) {
      console.error('[T4] download timeout. Console errors:\n' + consoleErrors.join('\n'))
      throw new Error(`PDF 下载超时 — console 错误:\n${consoleErrors.join('\n') || '(无)'}`)
    }

    const filename = download.suggestedFilename()
    expect(filename, 'PDF 文件名').toMatch(/\.pdf$/i)
  })
})
