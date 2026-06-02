/**
 * PRD-A-005 收尾 · 验收正路回归（G3/G4/G5/G6成功路径/G7正路）
 *
 * 被测对象（PRD-A-005 收尾 4 块）：
 *   - A 试卷删除：POST /teacher/exam/paper/delete {paperId} — owner 校验 + 级联删三表
 *   - C 试卷编辑：POST /teacher/exam/paper/update — 重排/删/增题 → biz_paper_question 持久化
 *   - D 收藏页：GET /teacher/qd/favorite/page + toggle/cancel
 *   - 收藏夹 CRUD：GET /teacher/center/q-folder/tree + create/rename/delete（本人正路）
 *
 * 契约层为主（page.evaluate 直打 /api，断言 envelope code + 数据），关键 UI 流少而精。
 * /teacher/** 走 MisiktEnvelopeAdvice：成功 envelope = {code:1, message, response}；
 *   业务异常透传原 code（如 ServiceException → code:500）；403 NotRole → code:403。
 *
 * 跑：
 *   cd codeplace-O/book-test
 *   pnpm exec playwright test prd-a-005-acceptance --reporter=list
 *
 * 前置：BE :8080 起 + DB miskt_data2（teacher001=user_id 5）+ FE vite :4010。
 * 数据自包含：自建自删（create → 验 → delete），不污染基线。
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD, CLIENT_ID } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// 全套写操作 + 依赖 dev 数据契约 — prod 跳过
test.skip(IS_PROD, 'local-only: 写操作 / dev 数据契约 / 雪花 id')

// ── page context 里直打 /api 的 helper（携带 LS 里的 auth token，走 vite proxy）──
async function apiPost(page: Page, url: string, body: unknown): Promise<{ code: any; message: any; response: any; httpStatus: number }> {
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

async function apiGet(page: Page, url: string): Promise<{ code: any; response: any; httpStatus: number }> {
  return page.evaluate(async (u) => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api' + u, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id },
    })
    const j: any = await r.json()
    return { code: j.code, response: j.response, httpStatus: r.status }
  }, url)
}

async function apiDelete(page: Page, url: string): Promise<{ code: any; httpStatus: number }> {
  return page.evaluate(async (u) => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api' + u, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id },
    })
    const j: any = await r.json()
    return { code: j.code, httpStatus: r.status }
  }, url)
}

test.describe('PRD-A-005 收尾 · 验收正路', () => {

  // ════════════════════════════════════════════════════════════
  // G6 成功路径 + G4：造本人卷 → 编辑（重排/删/增）→ 删除级联
  // ════════════════════════════════════════════════════════════
  test('G4+G6 本人卷：创建→编辑(重排/删/增)持久化→删除级联清三表', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // 1) 创建本人卷（3 题）
    const created = await apiPost(page, '/teacher/exam/paper/create', {
      name: 'REGTEST-A005-' + Date.now().toString().slice(-8),
      questionIds: [9760, 9761, 9762],
    })
    expect(created.code, 'create envelope code=1').toBe(1)
    const paperId = created.response?.paperId
    expect(paperId, 'create 返 paperId').toBeTruthy()

    // 2) detail 拿 sectionId + 验初始题集顺序
    const d0 = await apiPost(page, '/teacher/exam/paper/detail', { paperId })
    expect(d0.code).toBe(1)
    const sec = d0.response?.sections?.[0]
    const sectionId = sec?.sectionId
    expect(sectionId, 'detail section.sectionId 存在').toBeTruthy()
    const beforeIds = (sec?.questions || []).map((q: any) => q.id)
    expect(beforeIds, '初始题集 = 入参 3 题保序').toEqual([9760, 9761, 9762])

    // 3) G4 编辑：删 9760、保留 9761/9762 倒序重排、增 9763 → 最终 [9762,9761,9763]
    const edited = await apiPost(page, '/teacher/exam/paper/update', {
      paperId,
      questions: [
        { questionId: 9762, sectionId, sort: 1, score: 5 },
        { questionId: 9761, sectionId, sort: 2, score: 5 },
        { questionId: 9763, sectionId, sort: 3, score: 5 },
      ],
    })
    expect(edited.code, 'update envelope code=1').toBe(1)
    const afterIds = (edited.response?.sections?.[0]?.questions || []).map((q: any) => q.id)
    expect(afterIds, 'G4 编辑后题集 = [9762,9761,9763]（删/排/增持久化）').toEqual([9762, 9761, 9763])
    expect(edited.response?.questionCount, 'questionCount 重算=3').toBe(3)
    expect(String(edited.response?.score), 'score 重算=15.00（3题×5）').toBe('15.00')

    // 4) 二次 detail 复查持久化（重读 DB）
    const d1 = await apiPost(page, '/teacher/exam/paper/detail', { paperId })
    const persisted = (d1.response?.sections?.[0]?.questions || []).map((q: any) => q.id)
    expect(persisted, 'G4 重读 detail 题集持久化一致').toEqual([9762, 9761, 9763])

    // 5) G6 成功路径：本人卷删除成功
    const del = await apiPost(page, '/teacher/exam/paper/delete', { paperId })
    expect(del.code, 'G6 本人卷删除成功 code=1').toBe(1)

    // 6) 删后 detail 返 null（卷已物理删）—— 级联清三表的 FE 可见证据
    const d2 = await apiPost(page, '/teacher/exam/paper/detail', { paperId })
    expect(d2.response, 'G6 删除后 detail 返 null（卷不存在）').toBeFalsy()
    // 注：三表级联清 0 的 DB 对账由 regression-tester mysql 已验，spec 用 detail null 兜底证据
  })

  // ════════════════════════════════════════════════════════════
  // G5：收藏列表 + toggle 收藏 + cancel 取消
  // ════════════════════════════════════════════════════════════
  test('G5 收藏：列表返当前用户收藏 + toggle 收藏入列 + cancel 取消出列', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // 0) 当前收藏列表基线
    const p0 = await apiGet(page, '/teacher/qd/favorite/page?pageNum=1&pageSize=50')
    expect(p0.code, 'favorite/page envelope code=1').toBe(1)
    const baseTotal = p0.response?.total ?? 0
    const baseIds = (p0.response?.list || p0.response?.records || []).map((q: any) => q.id)
    // 确保测试题 9762 不在基线（若在，先取消保证幂等）
    if (baseIds.includes(9762)) {
      await apiDelete(page, '/teacher/qd/favorite/9762')
    }

    // 1) toggle 收藏 9762（on）
    const tg = await apiPost(page, '/teacher/qd/favorite/9762', {})
    expect(tg.code, 'toggle code=1').toBe(1)
    expect(tg.response?.isFavorite, 'toggle 后 isFavorite=true').toBe(true)

    // 2) 列表应含 9762
    const p1 = await apiGet(page, '/teacher/qd/favorite/page?pageNum=1&pageSize=50')
    const ids1 = (p1.response?.list || p1.response?.records || []).map((q: any) => q.id)
    expect(ids1, 'G5 收藏后列表含 9762').toContain(9762)

    // 3) cancel 取消 9762
    const del = await apiDelete(page, '/teacher/qd/favorite/9762')
    expect(del.code, 'cancel code=1').toBe(1)

    // 4) 列表不再含 9762，total 回到基线
    const p2 = await apiGet(page, '/teacher/qd/favorite/page?pageNum=1&pageSize=50')
    const ids2 = (p2.response?.list || p2.response?.records || []).map((q: any) => q.id)
    expect(ids2, 'G5 取消后列表不含 9762').not.toContain(9762)
    expect(p2.response?.total, 'G5 total 回到基线').toBe(baseTotal)
  })

  // ════════════════════════════════════════════════════════════
  // G7 正路：收藏夹 create → rename → delete（本人）
  // ════════════════════════════════════════════════════════════
  test('G7 收藏夹正路：tree 默认夹首位 + 新建/改名/删除本人夹', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // 0) tree 首位恒为默认夹 {id:0, name:"我的试题"}
    const t0 = await apiGet(page, '/teacher/center/q-folder/tree')
    expect(t0.code, 'q-folder/tree code=1').toBe(1)
    const tree0 = t0.response || []
    expect(tree0[0]?.id, 'G7 默认夹 id=0 在首位').toBe(0)
    expect(tree0[0]?.name, 'G7 默认夹 name="我的试题"').toBe('我的试题')

    // 1) 新建夹 → 返新夹 id
    const nm = 'REGTEST夹-' + Date.now().toString().slice(-8)
    const c = await apiPost(page, '/teacher/center/q-folder/create', { name: nm, pid: 0 })
    expect(c.code, 'create code=1').toBe(1)
    const folderId = c.response
    expect(folderId, 'create 返 folderId').toBeTruthy()

    // 2) tree 应含新夹（带 createTime）
    const t1 = await apiGet(page, '/teacher/center/q-folder/tree')
    const found = (t1.response || []).find((f: any) => f.id === folderId)
    expect(found, 'G7 tree 含新建夹').toBeTruthy()
    expect(found?.name, 'G7 新夹名一致').toBe(nm)
    expect(found?.createTime, 'G7 新夹带 createTime').toBeTruthy()

    // 3) 改名（仅名称可改）
    const nm2 = nm + '-改名'
    const r = await apiPost(page, '/teacher/center/q-folder/rename', { id: folderId, name: nm2 })
    expect(r.code, 'rename code=1').toBe(1)
    const t2 = await apiGet(page, '/teacher/center/q-folder/tree')
    const found2 = (t2.response || []).find((f: any) => f.id === folderId)
    expect(found2?.name, 'G7 改名后 tree 显示新名').toBe(nm2)

    // 4) 删除（清理）
    const del = await apiPost(page, '/teacher/center/q-folder/delete', { id: folderId })
    expect(del.code, 'delete code=1').toBe(1)
    const t3 = await apiGet(page, '/teacher/center/q-folder/tree')
    const found3 = (t3.response || []).find((f: any) => f.id === folderId)
    expect(found3, 'G7 删除后 tree 不含该夹').toBeFalsy()
  })

  // ════════════════════════════════════════════════════════════
  // G5+G7 关键 UI 流：工作台收藏管理入口 + 收藏页可达（红线 = 入口可达性）
  // ════════════════════════════════════════════════════════════
  test('G5 UI：工作台「收藏管理」入口点进收藏页（入口可达性）', async ({ page }) => {
    await loginByApi(page, 'teacher')
    // 整页进工作台（loginByApi 已 reload，store 已 init token）
    await page.goto('/#/workspace')
    await page.waitForLoadState('load')
    await page.waitForTimeout(1200)

    // 工作台关键区块：我创建的卷 / 我的收藏 / 收藏管理 + 新建收藏夹 入口
    await expect(page.getByText('我创建的卷')).toBeVisible({ timeout: 10000 })
    const favMgrBtn = page.getByRole('button', { name: '收藏管理' })
    await expect(favMgrBtn, 'G5 工作台有「收藏管理」入口').toBeVisible()
    await expect(page.getByRole('button', { name: '新建收藏夹' }), 'G7 工作台有「新建收藏夹」入口').toBeVisible()
    await page.screenshot({ path: 'test-results/prd-a-005-g5-workspace.png', fullPage: true })

    // 点击进收藏页（红线：从用户入口点进，不直达 hash）
    await favMgrBtn.click()
    await page.waitForTimeout(800)
    const hash = await page.evaluate(() => location.hash)
    expect(hash, 'G5 点收藏管理跳 /favorites').toContain('/favorites')
    await expect(page.getByText('收藏管理')).toBeVisible()
    await page.screenshot({ path: 'test-results/prd-a-005-g5-favorites-page.png', fullPage: true })
  })
})
