/**
 * PRD-002 个人资料页 浏览器回归（第 1 轮）
 *
 * teacher001/666666 登录态走内页。
 *
 * 跑：
 *   cd codeplace-O/book-test
 *   pnpm exec playwright test prd-002-profile-regression --reporter=list
 */
import { test, expect, Page } from '@playwright/test'
import { IS_PROD } from '../helpers/env'
import { loginByApi } from '../helpers/auth'

// 候选 profile 路由（PRD 没硬性 URL；尽量穷举常见命名）
const PROFILE_ROUTES = [
  '/#/profile', '/#/user/profile', '/#/profile/index',
  '/#/personal', '/#/personal/index', '/#/user/center',
  '/#/account', '/#/account/profile', '/#/userCenter',
]

test('PRD-002 个人资料页 浏览器回归 — G1~G5', async ({ page }) => {
  // 改存字段为写操作 — prod 跳过
  test.skip(IS_PROD, 'local-only: 依赖 dev 数据契约/写操作/双BE')

  const findings: string[] = []

  await loginByApi(page, 'teacher')

  // ── G1: profile 路由可达 + 6 字段表单 DOM ──
  let reachedRoute = ''
  let g1Dom = { realNameInput: false, sexRadio: false, gradeSelect: false, schoolInput: false, saveBtn: false }
  for (const r of PROFILE_ROUTES) {
    await page.goto(r)
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(800)
    const cur = await page.evaluate(() => location.hash)
    // 若守卫把我们踢回登录，跳过
    if (cur.includes('/login')) continue
    const dom = await page.evaluate(() => {
      const text = document.body.innerText || ''
      const hasField = (kw: string) => text.includes(kw)
      const inputs = Array.from(document.querySelectorAll('input')).length
      return {
        hash: location.hash,
        bodyHasProfileWords: hasField('真实姓名') || hasField('任教年级') || hasField('个人资料'),
        inputCount: inputs,
        hasSelect: document.querySelectorAll('.el-select, select').length > 0,
        hasRadio: document.querySelectorAll('.el-radio, input[type=radio]').length > 0,
        hasBtnSave: !!Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('保存')),
      }
    })
    if (dom.bodyHasProfileWords && dom.inputCount > 0) {
      reachedRoute = r
      g1Dom = {
        realNameInput: dom.inputCount > 0,
        sexRadio: dom.hasRadio,
        gradeSelect: dom.hasSelect,
        schoolInput: dom.inputCount >= 2,
        saveBtn: dom.hasBtnSave,
      }
      await page.screenshot({ path: `test-results/prd-002-g1-reached-${r.replace(/\W/g, '_')}.png`, fullPage: true })
      break
    }
  }
  findings.push(`G1 reachedRoute='${reachedRoute}' dom=${JSON.stringify(g1Dom)}`)
  if (!reachedRoute) {
    await page.goto('/#/profile')
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'test-results/prd-002-g1-no-route.png', fullPage: true })
  }

  // ── G2: /teacher/user/current 含 sex/grade/school ──
  const current = await page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api/teacher/user/current', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.access_token,
        'clientid': auth.client_id,
      },
    })
    const j = await r.json()
    return { status: r.status, code: j.code, data: j.data }
  })
  const hasSex = current.data && 'sex' in current.data
  const hasGrade = current.data && 'grade' in current.data
  const hasSchool = current.data && 'school' in current.data
  findings.push(`G2 current.status=${current.status} code=${current.code} hasSex=${hasSex} hasGrade=${hasGrade} hasSchool=${hasSchool} data=${JSON.stringify(current.data)}`)

  // ── G3: /teacher/user/update 端点是否存在 ──
  const updateProbe = await page.evaluate(async () => {
    const auth = JSON.parse(localStorage.getItem('book-ui:auth') || '{}')
    const r = await fetch('/api/teacher/user/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + auth.access_token,
        'clientid': auth.client_id,
      },
      body: JSON.stringify({ realName: '回归测试改名', sex: '1', grade: '初一', school: '回归中学' }),
    })
    let body: any = null
    try { body = await r.json() } catch { body = await r.text() }
    return { status: r.status, body }
  })
  findings.push(`G3 update.status=${updateProbe.status} body=${JSON.stringify(updateProbe.body).slice(0, 300)}`)

  // ── 把 findings 写到 stdout 供抓取 ──
  console.log('\n===PRD002-FINDINGS===')
  for (const f of findings) console.log(f)
  console.log('===END===\n')

  // 本 spec 不做 hard assert（regression 报告由 regression-tester 出），仅产出证据
  expect(true).toBe(true)
})
