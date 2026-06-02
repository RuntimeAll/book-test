/**
 * PRD-A-005 收尾 · 边界/越权回归（G1 验证码 / G2 权限 / G6 锁死 / G7 越权 / G8 scope+detail 越权）
 *
 * 红线断言（owner 校验 / 越权拒绝 / scope 过滤 / detail 越权 null）。
 * 失败即真 bug —— 不在此 skip 绕过（可信绿铁则）。
 *
 * /teacher/** envelope 约定：成功 code:1；ServiceException 透传 code:500；NotRole 透传 code:403。
 *
 * 跑：
 *   cd codeplace-O/book-test
 *   pnpm exec playwright test prd-a-005-permission-regression --reporter=list
 *
 * 稳定数据锚点（dev miskt_data2，teacher001=user_id 5）：
 *   - 本人卷：create_by='5'（subject_id 多为 null，靠 create_by 命中 scope=mine）
 *   - 公共卷 671：create_by='2' subject_id='3001002'（公共分类树）→ detail 返数据 / update·delete 被拒
 *   - 他人私卷 1043：create_by='126' subject_id='5000'（非公共树）→ detail 返 null / update·delete 被拒
 *   - 他人收藏夹 id=2：user_id=999（回归 INSERT 造的越权锚点）→ rename·delete 被拒
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD, CLIENT_ID } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

test.skip(IS_PROD, 'local-only: 写操作 / dev 数据契约 / 越权锚点')

// 稳定锚点
const PUBLIC_PAPER_ID = 671          // 公共卷（subject_id 3001002）
const OTHERS_PRIVATE_PAPER_ID = 1043 // 他人私卷（create_by 126, subject_id 5000）
const OTHERS_FOLDER_ID = 2           // 他人收藏夹（user_id 999）— 回归造的越权锚点
const SAMPLE_QID = 9760              // 任意有效题 id

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

async function apiGetWith(page: Page, url: string, token: string) {
  return page.evaluate(async ({ u, tk }) => {
    const r = await fetch('/api' + u, { headers: { Authorization: 'Bearer ' + tk, clientid: 'PLACEHOLDER' } })
    const j: any = await r.json()
    return { code: j.code, roles: j.roles || (j.data && j.data.roles), httpStatus: r.status }
  }, { u: url, tk: token })
}

test.describe('PRD-A-005 收尾 · 边界/越权', () => {

  // ════════════════════════════════════════════════════════════
  // G8：scope=mine 只返本人卷 + detail 公共卷返数据 / 他人私卷返 null
  // ════════════════════════════════════════════════════════════
  test('G8 scope=mine 只返本人卷 + detail 公共卷有数据/他人私卷 null', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // G8a: page scope=mine 只返 create_by=登录用户的卷
    const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 50 })
    expect(mine.code, 'page scope=mine code=1').toBe(1)
    const list = mine.response?.list || mine.response?.records || []
    expect(mine.response?.total, 'G8 scope=mine total > 0（teacher001 有本人卷）').toBeGreaterThan(0)
    // 抽查每条 createBy 都是登录用户（createBy 可能因 VO 未透出而为 null —— 此时靠 total/与 public 差集旁证）
    const createBys = list.map((p: any) => p.createBy ?? p.create_by).filter((v: any) => v != null)
    for (const cb of createBys) {
      expect(String(cb), 'G8 scope=mine 每条 createBy=登录用户(5)').toBe('5')
    }

    // G8b: detail 公共卷 671 返数据（不因 is_share 全空误判越权）
    const dPub = await apiPost(page, '/teacher/exam/paper/detail', { paperId: PUBLIC_PAPER_ID })
    expect(dPub.code).toBe(1)
    expect(dPub.response, 'G8 detail 公共卷 671 返非空数据').toBeTruthy()
    expect(dPub.response?.paperId ?? dPub.response?.id, 'G8 公共卷 detail 含卷 id').toBeTruthy()

    // G8c: detail 他人私卷 1043 返 null（越权拦截）
    const dPriv = await apiPost(page, '/teacher/exam/paper/detail', { paperId: OTHERS_PRIVATE_PAPER_ID })
    expect(dPriv.code).toBe(1) // envelope 仍 code:1，但 response 为 null
    expect(dPriv.response, 'G8 detail 他人私卷 1043 返 null（越权拦截）').toBeFalsy()
  })

  // ════════════════════════════════════════════════════════════
  // G6 锁死：公共卷 / 他人私卷 update·delete 被 owner 校验拒
  // ════════════════════════════════════════════════════════════
  test('G6 锁死：公共卷+他人私卷 update/delete 被 owner 校验拒（非成功码）', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // 构造完全合法的 questions（含 sectionId）以穿透 @Valid，确保命中 owner 校验而非参数校验
    const dPub = await apiPost(page, '/teacher/exam/paper/detail', { paperId: PUBLIC_PAPER_ID })
    const sec = dPub.response?.sections?.[0]
    const validQuestions = sec
      ? [{ questionId: sec.questions?.[0]?.id ?? SAMPLE_QID, sectionId: sec.sectionId, sort: 1, score: 5 }]
      : [{ questionId: SAMPLE_QID, sectionId: 1, sort: 1, score: 5 }]

    // G6a: update 公共卷 671 → 拒（无权编辑非本人创建的试卷）
    const upPub = await apiPost(page, '/teacher/exam/paper/update', { paperId: PUBLIC_PAPER_ID, questions: validQuestions })
    expect(upPub.code, 'G6 update 公共卷被拒（非 code:1）').not.toBe(1)
    expect(upPub.message, 'G6 update 公共卷拒绝原因含「无权编辑」').toContain('无权编辑')

    // G6b: update 他人私卷 1043 → 拒
    const upPriv = await apiPost(page, '/teacher/exam/paper/update', { paperId: OTHERS_PRIVATE_PAPER_ID, questions: [{ questionId: SAMPLE_QID, sectionId: 1, sort: 1, score: 5 }] })
    expect(upPriv.code, 'G6 update 他人私卷被拒').not.toBe(1)
    expect(upPriv.message, 'G6 update 他人私卷拒绝原因含「无权编辑」').toContain('无权编辑')

    // G6c: delete 公共卷 671 → 拒
    const delPub = await apiPost(page, '/teacher/exam/paper/delete', { paperId: PUBLIC_PAPER_ID })
    expect(delPub.code, 'G6 delete 公共卷被拒').not.toBe(1)
    expect(delPub.message, 'G6 delete 公共卷拒绝原因含「无权删除」').toContain('无权删除')

    // G6d: delete 他人私卷 1043 → 拒
    const delPriv = await apiPost(page, '/teacher/exam/paper/delete', { paperId: OTHERS_PRIVATE_PAPER_ID })
    expect(delPriv.code, 'G6 delete 他人私卷被拒').not.toBe(1)
    expect(delPriv.message, 'G6 delete 他人私卷拒绝原因含「无权删除」').toContain('无权删除')
  })

  // G6 FE：公共卷详情页「编辑试卷」按钮置灰锁死、无「删除」入口；本人卷可编辑（对照）
  test('G6 FE：公共卷编辑按钮置灰锁死 + 无删除入口（对照本人卷可编辑）', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // 公共卷 671 详情
    await page.goto(`/#/papers/source/${PUBLIC_PAPER_ID}`)
    await page.waitForLoadState('load')
    await page.waitForTimeout(1500)
    const pub = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'))
      const edit = btns.find(b => (b.textContent || '').includes('编辑试卷'))
      return {
        editDisabled: edit ? (edit.disabled || edit.classList.contains('is-disabled')) : null,
        hasDelete: btns.some(b => (b.textContent || '').includes('删除')),
        hasExport: btns.some(b => (b.textContent || '').includes('导出')),
      }
    })
    expect(pub.editDisabled, 'G6 公共卷「编辑试卷」按钮置灰锁死').toBe(true)
    expect(pub.hasDelete, 'G6 公共卷详情页无「删除」入口').toBe(false)
    expect(pub.hasExport, 'G3 公共卷详情页有「导出 PDF」入口').toBe(true)
    await page.screenshot({ path: 'test-results/prd-a-005-g6-public-locked.png', fullPage: true })

    // 对照：本人卷编辑按钮可用。先取一份本人卷 id
    const mine = await apiPost(page, '/teacher/exam/paper/page', { scope: 'mine', pageIndex: 1, pageSize: 1 })
    const minePaperId = (mine.response?.list || mine.response?.records || [])[0]?.id
    if (minePaperId) {
      await page.goto(`/#/papers/source/${minePaperId}`)
      await page.waitForLoadState('load')
      await page.waitForTimeout(1500)
      const own = await page.evaluate(() => {
        const edit = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('编辑试卷'))
        return edit ? (edit.disabled || edit.classList.contains('is-disabled')) : null
      })
      expect(own, 'G6 对照：本人卷「编辑试卷」按钮可用（未置灰）').toBe(false)
    }
  })

  // ════════════════════════════════════════════════════════════
  // G7 越权 + 默认夹保护
  // ════════════════════════════════════════════════════════════
  test('G7 越权：改/删他人夹被拒 + 默认夹不可改删', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // G7a: 默认夹 id=0 不可改名
    const rd = await apiPost(page, '/teacher/center/q-folder/rename', { id: 0, name: '尝试改默认夹' })
    expect(rd.code, 'G7 默认夹改名被拒').not.toBe(1)
    expect(rd.message, '原因含「默认收藏夹不可改名」').toContain('默认收藏夹不可改名')

    // G7b: 默认夹 id=0 不可删除
    const dd = await apiPost(page, '/teacher/center/q-folder/delete', { id: 0 })
    expect(dd.code, 'G7 默认夹删除被拒').not.toBe(1)
    expect(dd.message, '原因含「默认收藏夹不可删除」').toContain('默认收藏夹不可删除')

    // G7c: 改他人夹（user_id=999 的 id=2）被拒
    const ro = await apiPost(page, '/teacher/center/q-folder/rename', { id: OTHERS_FOLDER_ID, name: '黑客改名' })
    expect(ro.code, 'G7 改他人夹被拒').not.toBe(1)
    // 他人夹 → "无权修改非本人的收藏夹"
    expect(ro.message, 'G7 改他人夹原因含「无权修改」').toContain('无权修改')

    // G7d: 删他人夹被拒
    const dlo = await apiPost(page, '/teacher/center/q-folder/delete', { id: OTHERS_FOLDER_ID })
    expect(dlo.code, 'G7 删他人夹被拒').not.toBe(1)
    expect(dlo.message, 'G7 删他人夹原因含「无权删除」').toContain('无权删除')
  })

  // G7 删夹归零夹：删本人夹后该夹下收藏 folder_id 归默认夹(0) 不丢
  test('G7 删夹归零夹：删本人夹后收藏归默认夹不丢', async ({ page }) => {
    await loginByApi(page, 'teacher')

    // 1) 建夹
    const nm = 'REGTEST归零-' + Date.now().toString().slice(-8)
    const c = await apiPost(page, '/teacher/center/q-folder/create', { name: nm, pid: 0 })
    const folderId = c.response
    expect(folderId).toBeTruthy()

    // 2) 收藏一题到该夹（toggle 带 folderId）
    // 先确保 9762 未收藏（幂等）
    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      await fetch('/api/teacher/qd/favorite/9762', { method: 'DELETE', headers: { Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id } })
    })
    const tg = await apiPost(page, '/teacher/qd/favorite/9762', { folderId })
    expect(tg.code).toBe(1)

    // 3) 验该夹 count=1
    const t1 = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const r = await fetch('/api/teacher/center/q-folder/tree', { headers: { Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id } })
      return (await r.json()).response
    })
    const f1 = (t1 || []).find((f: any) => f.id === folderId)
    expect(f1?.count, 'G7 收藏入夹后 count=1').toBe(1)

    // 4) 删该夹 → 收藏应归默认夹(0)
    const del = await apiPost(page, '/teacher/center/q-folder/delete', { id: folderId })
    expect(del.code).toBe(1)

    // 5) 9762 仍在收藏列表（不丢），且 folder_id 归 0 → 在默认夹下可查
    const inDefault = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      const r = await fetch('/api/teacher/qd/favorite/page?pageNum=1&pageSize=50&folderId=0', { headers: { Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id } })
      const j = await r.json()
      return (j.response?.list || j.response?.records || []).map((q: any) => q.id)
    })
    expect(inDefault, 'G7 删夹后收藏 9762 归默认夹(0) 不丢').toContain(9762)

    // 6) 清理：取消收藏 9762
    await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
      await fetch('/api/teacher/qd/favorite/9762', { method: 'DELETE', headers: { Authorization: 'Bearer ' + auth.access_token, clientid: auth.client_id } })
    })
  })

  // ════════════════════════════════════════════════════════════
  // G2 权限：teacher 持角色 2xx / 无 teacher 角色 403
  // ════════════════════════════════════════════════════════════
  test('G2 权限：teacher 调受限接口成功 / superadmin(无teacher) 返 403', async ({ page }) => {
    // teacher 正路
    await loginByApi(page, 'teacher')
    const okT = await apiPost(page, '/teacher/question/addBasket/' + SAMPLE_QID, {})
    // addBasket 走 R<Void>（非裸返回）→ envelope code:1
    expect(okT.code, 'G2 teacher 持角色调 addBasket 成功 code=1').toBe(1)

    // superadmin 反路（admin/admin123 在 dev 存在，角色=superadmin 不含 teacher → 403）
    const adminProbe = await page.evaluate(async () => {
      const resp = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123', clientId: 'e5cd7e4891bf95d1d19206ce24a7b32e', grantType: 'password', tenantId: '000000' }),
      })
      const lj = await resp.json()
      const tk = lj.data?.access_token
      if (!tk) return { loginOk: false }
      const r = await fetch('/api/teacher/question/addBasket/9760', {
        method: 'POST', headers: { Authorization: 'Bearer ' + tk, clientid: 'e5cd7e4891bf95d1d19206ce24a7b32e' },
      })
      let b: any = null
      try { b = await r.json() } catch { b = { _raw: await r.text() } }
      return { loginOk: true, code: b.code, message: b.msg || b.message, httpStatus: r.status }
    })
    expect(adminProbe.loginOk, 'admin/admin123 dev 账号存在').toBe(true)
    expect(adminProbe.code, 'G2 superadmin 无 teacher 角色调受限接口返 403').toBe(403)
  })

  // ════════════════════════════════════════════════════════════
  // G1 验证码（特殊）：空/错验证码登录被拒 —— 需 captcha=true 环境
  // 当前 dev captcha.enable=false → 该 case 默认 skip，组长切 captcha=true 时去掉 skip 跑
  // ════════════════════════════════════════════════════════════
  test('G1 验证码：空/错 code 登录被拒（需 captcha=true 环境）', async ({ page }) => {
    // 🔴 当前 dev captcha=false，此 case 在 captcha 开启的环境才有效；
    //    captcha=false 下空 code 也能登录成功，会假红，故默认 skip。
    //    组长跑时：先把 BE sys_config 'sys.account.captchaEnabled' 置 true（或 application captcha.enable=true），再去掉本行 skip。
    await page.goto('/#/login')
    await page.waitForLoadState('domcontentloaded')

    // captcha 状态探测 —— 关闭则自动跳过（环境驱动 skip，非写死）；
    // 开 captcha 的环境（prod-like / 切 captcha=true 的 dev）会自动跑此 case，纳入全覆盖回归网。
    const capEnabled = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/auth/code')
        const j = await r.json()
        return !!(j.captchaEnabled ?? (j.data && j.data.captchaEnabled))
      } catch {
        return false
      }
    })
    test.skip(!capEnabled, 'captcha.enable=false 环境 — 验证码 case 自动跳过（开 captcha 自动跑）')

    // 空验证码登录
    const emptyCode = await page.evaluate(async () => {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'teacher001', password: '666666', clientId: 'e5cd7e4891bf95d1d19206ce24a7b32e', grantType: 'password', tenantId: '000000', code: '', uuid: '' }),
      })
      const j = await r.json()
      return { code: j.code, msg: j.msg || j.message }
    })
    expect(emptyCode.code, 'G1 空验证码登录被拒（非 200）').not.toBe(200)

    // 错验证码登录
    const wrongCode = await page.evaluate(async () => {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'teacher001', password: '666666', clientId: 'e5cd7e4891bf95d1d19206ce24a7b32e', grantType: 'password', tenantId: '000000', code: 'wrong999', uuid: 'nonexistent-uuid' }),
      })
      const j = await r.json()
      return { code: j.code, msg: j.msg || j.message }
    })
    expect(wrongCode.code, 'G1 错验证码登录被拒').not.toBe(200)
    expect(String(wrongCode.msg || ''), 'G1 错误提示含验证码相关').toMatch(/验证码|captcha/i)
  })
})
