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
  test('G4 旧路由 /papers/edit/:id 重定向到 source 编辑态', async ({ page }) => {
    await loginByApi(page, 'teacher')
    const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 1 })
    const pid = (mine.response?.list || mine.response?.records || [])[0]?.id
    expect(pid, 'G4 取到一份本人卷').toBeTruthy()

    await page.goto(`/#/papers/edit/${pid}`)
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    // 重定向后 hash 应落在 source/:id 且带 edit=1（不进废弃 editExisting）
    expect(page.url(), 'G4 重定向到 source 页').toContain(`/papers/source/${pid}`)
    expect(page.url(), 'G4 带 edit=1 自动进编辑态').toContain('edit=1')
  })

  // ════════════════════════════════════════════════════════════
  // G1+G2 owner 原地进编辑态 + 编辑态题卡骨架/操作
  // ════════════════════════════════════════════════════════════
  test('G1+G2 owner 点编辑原地切编辑态 + 题卡复用查看骨架带排序/删/分值', async ({ page }) => {
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

    // 点"编辑试卷"→ 原地进编辑态（URL 仍 source，不跳 /papers/edit 独立页）
    await page.locator('button', { hasText: '编辑试卷' }).first().click()
    await page.waitForTimeout(800)
    expect(page.url(), 'G1 编辑不跳独立页（URL 仍 source）').toContain(`/papers/source/${pid}`)
    expect(page.url(), 'G1 未跳到旧 /papers/edit 独立页').not.toContain('/papers/edit')

    // 编辑态：有 保存 / 增题 / 取消
    expect(await page.locator('button', { hasText: '保存' }).count(), 'G1 编辑态有保存').toBeGreaterThan(0)
    expect(await page.locator('button', { hasText: '增题' }).count(), 'G1 编辑态有增题').toBeGreaterThan(0)

    // G2 编辑态题卡复用查看骨架 .source-question-card.edit-card + 分值输入 + 排序操作
    expect(await page.locator('.source-question-card.edit-card').count(), 'G2 复用 .source-question-card 骨架').toBeGreaterThan(0)
    expect(await page.locator('.edit-score .el-input-number').count(), 'G2 每题有分值输入').toBeGreaterThan(0)
    expect(await page.locator('.edit-ops button').count(), 'G2 题卡有排序/删除操作').toBeGreaterThan(0)
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
