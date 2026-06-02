/**
 * system 基线 · 试卷/收藏夹 CRUD 接口契约边界用例（范式示范）
 *
 * 背景（PRD-A-005 收尾沉淀）：本卡新增 delete/update/folder CRUD 接口，
 * 此前 system 基线缺少「鉴权 / 缺参 / 不存在 id」这类负向边界范式。
 * 本 spec 建立该范式 —— 存量历史接口的全量负向补齐不在本次范围，按需逐步扩。
 *
 * 范式要点：
 *   - 鉴权边界：无 token / 错 token 调 @SaCheckLogin 接口被拒
 *   - 参数边界：缺必填字段 / 非法值 → 非成功码（不静默成功）
 *   - 不存在资源：不存在 paperId → 明确报错（不 NPE / 不假成功）
 *
 * 跑：
 *   cd codeplace-O/book-test
 *   pnpm exec playwright test api-paper-crud-boundary --reporter=list
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

test.skip(IS_PROD, 'local-only: dev 数据契约 / 写操作')

async function apiPostNoAuth(page: Page, url: string, body: unknown) {
  return page.evaluate(async ({ u, b }) => {
    const r = await fetch('/api' + u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // 故意不带 Authorization
      body: JSON.stringify(b),
    })
    let j: any = null
    try { j = await r.json() } catch { j = { _raw: await r.text() } }
    return { code: j.code, message: j.message ?? j.msg, httpStatus: r.status }
  }, { u: url, b: body })
}

async function apiPostAuth(page: Page, url: string, body: unknown) {
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

test.describe('system · CRUD 接口契约边界范式', () => {

  // ── 鉴权边界：无 token 调 @SaCheckLogin 接口被拒 ──
  test('鉴权边界：无 token 调 paper/delete + q-folder/create 被拒', async ({ page }) => {
    await page.goto('/#/login')
    await page.waitForLoadState('domcontentloaded')

    const delNoAuth = await apiPostNoAuth(page, '/teacher/exam/paper/delete', { paperId: 671 })
    expect(delNoAuth.code, '无 token 调 delete 被拒（非 code:1）').not.toBe(1)

    const createNoAuth = await apiPostNoAuth(page, '/teacher/center/q-folder/create', { name: 'x' })
    expect(createNoAuth.code, '无 token 调 folder/create 被拒').not.toBe(1)
  })

  // ── 参数边界：缺必填 paperId → 明确报错 ──
  test('参数边界：delete 缺 paperId / folder rename 缺 id → 非成功码', async ({ page }) => {
    await loginByApi(page, 'teacher')

    const delNoId = await apiPostAuth(page, '/teacher/exam/paper/delete', {})
    expect(delNoId.code, 'delete 缺 paperId 被拒').not.toBe(1)
    expect(delNoId.message, '原因含「试卷ID不能为空」').toContain('试卷ID')

    const renameNoId = await apiPostAuth(page, '/teacher/center/q-folder/rename', { name: '无id改名' })
    expect(renameNoId.code, 'rename 缺 id 被拒').not.toBe(1)

    const createNoName = await apiPostAuth(page, '/teacher/center/q-folder/create', { pid: 0 })
    expect(createNoName.code, 'create 缺 name 被拒').not.toBe(1)
    expect(createNoName.message, '原因含「名称不能为空」').toContain('名称')
  })

  // ── 不存在资源：不存在 paperId delete → 明确报错（不假成功 / 不 NPE）──
  test('不存在资源：delete 不存在 paperId → 明确报错', async ({ page }) => {
    await loginByApi(page, 'teacher')
    const del = await apiPostAuth(page, '/teacher/exam/paper/delete', { paperId: 999999999 })
    expect(del.code, 'delete 不存在卷被拒').not.toBe(1)
    // 不存在 → "试卷不存在" 或 owner 校验前置的 "试卷不存在"
    expect(del.message, '原因含「不存在」').toContain('不存在')
  })

  // ── detail 边界：缺 paperId → response 安全返 null（不 500/NPE）──
  test('detail 边界：缺 paperId → 安全返 null（不抛 500）', async ({ page }) => {
    await loginByApi(page, 'teacher')
    const d = await apiPostAuth(page, '/teacher/exam/paper/detail', {})
    expect(d.code, 'detail 缺 paperId envelope code=1（裸返回 null）').toBe(1)
    expect(d.response, 'detail 缺 paperId response=null').toBeFalsy()
  })
})
