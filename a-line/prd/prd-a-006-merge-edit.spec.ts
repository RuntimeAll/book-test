/**
 * PRD-A-006 组卷页面合并 —— 查看 ⇄ 编辑 双态同页（废弃 editExisting.vue）
 *
 * gates：
 *   G1 owner 点"编辑试卷"原地进编辑态（URL 仍 source，不跳独立页）+ 公共卷编辑按钮锁死
 *   G2 编辑态题卡复用查看骨架 .source-question-card + 每题有 排序/删除/分值
 *   G3 编辑保存持久化（改分值 → update → 重拉验证）
 *   G4 旧路由 /papers/edit/:id 重定向到 /papers/source/:id?edit=1（不进废弃页、不 404）
 *
 * 跑：
 *   cd codeplace-O/book-test
 *   pnpm exec playwright test prd-a-006-merge-edit --reporter=list
 *
 * 数据锚点（dev miskt_data2，teacher001=user_id 5）：本人卷靠 scope=mine 动态取；公共卷 671。
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

test.skip(IS_PROD, 'local-only: 写操作 / dev 数据契约')

const PUBLIC_PAPER_ID = 671

async function apiPost(page: Page, url: string, body: unknown) {
  return page.evaluate(async ({ u, b }) => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api' + u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id },
      body: JSON.stringify(b),
    })
    let j: any = null
    try { j = await r.json() } catch { j = { _raw: await r.text() } }
    return { code: j.code, message: j.message ?? j.msg, response: j.response, httpStatus: r.status }
  }, { u: url, b: body })
}

test.describe('PRD-A-006 组卷页面合并（查看⇄编辑双态）', () => {

  // ════════════════════════════════════════════════════════════
  // G4 旧路由重定向
  // ════════════════════════════════════════════════════════════
  // 现行契约（PRD-A-007 router/index.ts:74-75）：
  //   /papers/edit/:id → redirect → /papers/workbench/:id（新两栏工作台编辑态）
  // 原 PRD-A-006 设计（redirect 到 source/:id?edit=1）已被 A-007 工作台取代。
  test('G4 旧路由 /papers/edit/:id 重定向到 workbench 编辑态', async ({ page }) => {
    await loginByApi(page, 'teacher')
    const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 1 })
    const pid = (mine.response?.list || mine.response?.records || [])[0]?.id
    expect(pid, 'G4 取到一份本人卷').toBeTruthy()

    await page.goto(`/#/papers/edit/${pid}`)
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    // PRD-A-007：重定向后落 /papers/workbench/:id（新两栏工作台，编辑态 = 带 id 参数）
    expect(page.url(), 'G4 重定向到 workbench 编辑态').toContain(`/papers/workbench/${pid}`)
  })

  // ════════════════════════════════════════════════════════════
  // G1+G2 owner 点编辑跳 workbench + 工作台题卡骨架/操作
  // ════════════════════════════════════════════════════════════
  // 现行契约（PRD-A-007 source.vue enterEdit()）：
  //   source 页点"编辑试卷" → router.push(/papers/workbench/${paperId})
  //   不再"原地切编辑态"，而是跳到新两栏工作台（编辑态 = 带 id 参数）。
  //   workbench 题卡 class = source-question-card workbench-card（复用骨架）。
  //   右栏有"保存修改"按钮（编辑态）、"换一题"功能、toolbar-score 分值输入。
  test('G1+G2 owner 点编辑跳 workbench + 题卡复用查看骨架带排序/删/分值', async ({ page }) => {
    await loginByApi(page, 'teacher')
    // 找一份有题的本人卷
    const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 50 })
    const list = mine.response?.list || mine.response?.records || []
    let pid: number | null = null
    for (const p of list) {
      const d = await apiPost(page, '/teacher/exam/paper/detail', { paperId: p.id })
      const qs = (d.response?.sections || []).flatMap((s: any) => s.questions || [])
      if (qs.length >= 1) { pid = p.id; break }
    }
    expect(pid, 'G1 找到一份有题本人卷').toBeTruthy()

    await page.goto(`/#/papers/source/${pid}`)
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)

    // 点"编辑试卷" → PRD-A-007 改：跳到 /papers/workbench/:id（新两栏工作台）
    await page.locator('button', { hasText: '编辑试卷' }).first().click()
    await page.waitForTimeout(1500)
    // 现行：跳 workbench，不再留在 source
    expect(page.url(), 'G1 编辑跳 workbench 编辑态').toContain(`/papers/workbench/${pid}`)
    expect(page.url(), 'G1 未跳到旧 /papers/edit 独立页').not.toContain('/papers/edit')

    // 等 workbench 加载完（loadPaperDetail 异步，需等题卡渲染出来）
    await page.waitForSelector('.source-question-card', { timeout: 15000 })

    // 编辑态：右栏有"保存修改"按钮（workbench 编辑态）
    expect(await page.locator('button', { hasText: '保存修改' }).count(), 'G1 workbench 编辑态有保存修改').toBeGreaterThan(0)

    // G2 题卡复用 .source-question-card 骨架（workbench 添加了 workbench-card 额外 class）
    expect(await page.locator('.source-question-card').count(), 'G2 复用 .source-question-card 骨架').toBeGreaterThan(0)
    // 分值输入在 .toolbar-score 内的 el-input-number
    expect(await page.locator('.toolbar-score .el-input-number').count(), 'G2 每题有分值输入').toBeGreaterThan(0)
    // 排序/删除操作在 .q-toolbar 内（上移/下移/删除按钮）
    expect(await page.locator('.q-toolbar button').count(), 'G2 题卡有排序/删除操作').toBeGreaterThan(0)
    await page.screenshot({ path: 'test-results/prd-a-006-edit-mode.png', fullPage: true })
  })

  // G1 公共卷编辑按钮锁死（对照组：放行态在上一 case 已验本人卷可进编辑）
  test('G1 公共卷编辑按钮锁死（不可进编辑态）', async ({ page }) => {
    await loginByApi(page, 'teacher')
    await page.goto(`/#/papers/source/${PUBLIC_PAPER_ID}`)
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    const editDisabled = await page.evaluate(() => {
      const edit = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('编辑试卷'))
      return edit ? (edit.disabled || edit.classList.contains('is-disabled')) : null
    })
    expect(editDisabled, 'G1 公共卷「编辑试卷」按钮锁死').toBe(true)
  })

  // ════════════════════════════════════════════════════════════
  // G3 编辑保存持久化（API 层稳态验证）
  // ════════════════════════════════════════════════════════════
  test('G3 编辑保存持久化：改分值 → update → 重拉验证', async ({ page }) => {
    await loginByApi(page, 'teacher')
    const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 50 })
    const list = mine.response?.list || mine.response?.records || []
    let pid: number | null = null
    let detail: any = null
    for (const p of list) {
      const d = await apiPost(page, '/teacher/exam/paper/detail', { paperId: p.id })
      const qs = (d.response?.sections || []).flatMap((s: any) => s.questions || [])
      if (qs.length >= 1) { pid = p.id; detail = d.response; break }
    }
    expect(pid, 'G3 找到一份有题本人卷').toBeTruthy()

    const sections = detail.sections || []
    const q0 = sections[0].questions[0]
    // 构造 update：把 q0 分值改成 7，其余保持
    const questions = sections.flatMap((s: any) =>
      (s.questions || []).map((q: any, qi: number) => ({
        questionId: q.id,
        sectionId: s.sectionId,
        sort: qi + 1,
        score: q.id === q0.id ? 7 : Number(q.pqScore ?? q.score ?? 5),
      })),
    )
    const up = await apiPost(page, '/teacher/exam/paper/update', { paperId: pid, name: detail.paperName, questions })
    expect(up.code, 'G3 本人卷 update 成功').toBe(1)

    // 重拉验证 q0 分值持久化为 7
    const d2 = await apiPost(page, '/teacher/exam/paper/detail', { paperId: pid })
    const q0b = (d2.response?.sections || []).flatMap((s: any) => s.questions || []).find((q: any) => q.id === q0.id)
    expect(Number(q0b?.pqScore ?? q0b?.score), 'G3 q0 分值持久化为 7').toBe(7)
  })
})
