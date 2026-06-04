/**
 * 组卷 createExamPaper API 冒烟（system 基线）
 *
 * 覆盖：
 *   T2. createExamPaper API 200 — 直接 fetch /teacher/exam/paper/create 拿 paperId
 *
 * 🔴 2026-06-04 精简（PRD-A-007 组卷工作台重构）：
 *   原 T1/T3/T4 测老 /question/compose 页（compose.vue，断言 .page-title / .name-input /
 *   旧 LS key book-ui:basket-ids）。PRD-A-007 已把 /question/compose 重定向到 /papers/workbench，
 *   老页/老选择器全失效 → T1/T3/T4 是陈旧假红，已删。
 *   - 旧路由重定向不 404 → 由 prd-a-007-workbench.spec.ts「G1 路由收敛」真验。
 *   - 组卷工作台 UI 全流程 → 由 prd-a-007-workbench.spec.ts 覆盖。
 *   - 本文件仅保留 T2（与 UI 无关的纯 create API 契约冒烟）。
 *
 * 跑前置：BE :8080 起；题库 ≥ 2 题（V1 ETL 就位）。
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD, CLIENT_ID } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// local-only: 组卷为写操作
test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作')

/**
 * 通过 fetch 拿题库前 N 题的 id（不走 UI，节省时间）。
 */
async function fetchQuestionIds(page: Page, token: string, count: number): Promise<number[]> {
  const ids = await page.evaluate(async ({ tk, n, cid }) => {
    const resp = await fetch('/api/teacher/question/page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tk}`,
        clientid: cid,
      },
      body: JSON.stringify({ pageIndex: 1, pageSize: n }),
    })
    const j = await resp.json()
    const list = j?.response?.list || j?.data?.list || []
    return (list as Array<{ id: number }>).slice(0, n).map(q => q.id)
  }, { tk: token, n: count, cid: CLIENT_ID })
  expect(ids.length, '题库返题数不足 — V1 ETL 是否就位？').toBeGreaterThanOrEqual(count)
  return ids
}

test.describe('组卷 · createExamPaper API 冒烟', () => {

  test('T2. createExamPaper API 200 — 拿 paperId', async ({ page }) => {
    const token = await loginByApi(page, 'teacher')
    const questionIds = await fetchQuestionIds(page, token, 2)

    const result = await page.evaluate(async ({ tk, qids, cid }) => {
      const resp = await fetch('/api/teacher/exam/paper/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tk}`,
          clientid: cid,
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
    }, { tk: token, qids: questionIds, cid: CLIENT_ID })

    expect(result.status, 'HTTP 200').toBe(200)
    // /teacher/* 走 MisiktEnvelopeAdvice envelope { code:1, message:"成功", response: {paperId, questionCount} }
    expect(result.body?.code, 'envelope code=1 表示成功').toBe(1)
    expect(result.body?.response?.paperId, '返新 paperId').toBeTruthy()
    expect(result.body?.response?.questionCount, '题目数 = 2').toBe(2)
  })
})
