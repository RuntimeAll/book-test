/**
 * a-line/fixtures/contract.ts — FE↔BE 一致性断言契约层
 *
 * 设计意图（可信绿铁则）：
 *   绿 = 系统真没问题，红 = 真问题。
 *   期望值运行时从 BE 动态取，不写死魔法数；
 *   这样数据增长永不假红。
 *
 * 核心守门规则（PRD-O-003 Stage2a 定论）：
 *   题库/卷库页默认是「作用域过滤」的，不是全量：
 *   - FE 初始 total（如 2660）= 当前作用域（教材/学科树 + 版本下拉默认选中）下的题数
 *   - DB 全量（29437）≠ FE 初始 total，断言 ≥ 全量是错误假设
 *   - 真正的无数据异常守门 = FE 显示的数字必须与 BE 同参返回数一致
 *
 * 使用方式：
 *   import { expectFeBeTotalConsistent, callQuestionPageBe, callPaperPageBe } from '../fixtures/contract'
 */

import { expect, type Page } from '@playwright/test'

// ─── 内部 fetch helper（在 page context 里直接走 vite proxy）────────────────

type FetchBody = Record<string, unknown>

/**
 * 直打 /api/teacher/question/page，返 total。
 * 在 page.evaluate 里跑，走 vite proxy 链路，携带 localStorage 里的 auth token。
 */
export async function callQuestionPageBe(page: Page, body: FetchBody): Promise<number> {
  return page.evaluate(async (b) => {
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
 * 直打 /api/teacher/exam/paper/page，返 total。
 * 在 page.evaluate 里跑，走 vite proxy 链路，携带 localStorage 里的 auth token。
 */
export async function callPaperPageBe(page: Page, body: FetchBody): Promise<number> {
  return page.evaluate(async (b) => {
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

// ─── 断言 helper ──────────────────────────────────────────────────────────────

/**
 * 核心一致性断言：FE 显示的 total 必须 === BE 同参返回的 total。
 *
 * 这是「可信绿」的真正门禁：
 *   - 若 FE total < BE total  → FE 丢数据（真 bug）
 *   - 若 FE total > BE total  → 不可能（FE 从 BE 拿数），除非缓存脏
 *   - 若相等              → 无数据异常，green
 *
 * @param feTotal   FE 当前显示的 total（从 ctx.total / vm state 读取）
 * @param beTotal   BE 同参调用返回的 total（从 callQuestionPageBe / callPaperPageBe 取）
 * @param label     断言描述，方便定位失败点
 */
export function expectFeBeTotalConsistent(feTotal: number, beTotal: number, label: string): void {
  expect(feTotal, `${label}: FE total 不能为负`).toBeGreaterThanOrEqual(0)
  expect(beTotal, `${label}: BE total 不能为负（-1=接口失败）`).toBeGreaterThanOrEqual(0)
  expect(feTotal, `${label}: FE 显示 total(${feTotal}) 必须 === BE 同参 total(${beTotal})（数据一致性）`).toBe(beTotal)
}

/**
 * 筛选有效性断言：施加筛选后 total 必须 > 0 且 ≤ 无筛选时 total。
 *
 * @param filteredTotal   施加筛选后的 total（FE 显示）
 * @param baseTotal       无筛选/基准态 total（同作用域）
 * @param label           断言描述
 */
export function expectFilterReduces(filteredTotal: number, baseTotal: number, label: string): void {
  expect(filteredTotal, `${label}: 筛选后至少有 1 条结果`).toBeGreaterThan(0)
  expect(filteredTotal, `${label}: 筛选后 total(${filteredTotal}) 应 ≤ 基准 total(${baseTotal})`).toBeLessThanOrEqual(baseTotal)
}
