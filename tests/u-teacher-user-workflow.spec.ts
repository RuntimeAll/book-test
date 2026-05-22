/**
 * U 卡（教师端用户业务流串通）回归测试套
 *
 * 覆盖：
 *   - admin/admin123 登录 → 跳 /home（向后兼容） + 看见全部菜单
 *   - teacher001/666666 登录 → 跳 /workspace（角色分流）+ 4 section 渲染
 *   - teacher 角色看不见 作业 / 学生 / 班级 占位菜单
 *   - /teacher/user/current 返 roles 字段（U 卡 BE 新增）
 *   - /teacher/exam/paper/page 接受 createBy 参数过滤（U-6 BE 新增）
 *
 * 跑前置：
 *   1. BE 必须起：cd codeSpace/book-server/ruoyi-admin && mvn spring-boot:run
 *   2. DB 已落 U 卡段① 配置（teacher001 / role_key='teacher'）
 *   3. admin / teacher001 账号都能登录
 *
 * 跑：
 *   pnpm test:u                  # 默认 headless
 *   pnpm test:u:headed           # 看浏览器
 */
import { test, expect, Page } from '@playwright/test'

// ─── 测试常量 ────────────────────────────────────────────────
const ADMIN_USER = 'admin'
const ADMIN_PWD = 'admin123'
const TEACHER_USER = 'teacher001'
const TEACHER_PWD = '666666'
const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'

// ─── 公共 helper（基于 v1 spec loginAsAdmin 衍生）──────────────────────

/**
 * 通用登录 — 走 /auth/login fetch 拿 token 注入 localStorage。
 * 不 reload —— 由 caller 在 goto 业务页前自行 reload（让 store init 拿到 localStorage）。
 */
async function loginAs(
  page: Page,
  username: string,
  password: string,
): Promise<string> {
  await page.goto('/#/login')
  await page.waitForLoadState('domcontentloaded')

  const token = await page.evaluate(async ({ user, pwd, cid }) => {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: user,
        password: pwd,
        clientId: cid,
        grantType: 'password',
        tenantId: '000000',
      }),
    })
    const j = await resp.json()
    const data = j.data || {}
    const auth = {
      scope: data.scope ?? null,
      openid: data.openid ?? null,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expire_in: data.expire_in,
      refresh_expire_in: data.refresh_expire_in,
      client_id: cid,
    }
    localStorage.setItem('book-ui:auth', JSON.stringify(auth))
    return data.access_token as string
  }, { user: username, pwd: password, cid: CLIENT_ID })

  expect(token, `登录失败 — ${username} 账号是否存在？BE 8080 是否起？`).toBeTruthy()
  return token
}

/**
 * 调 /api/teacher/user/current 拿当前用户信息（含 roles）。
 * 直接 fetch 不走 FE UI 链路 — 用于验证 BE 改动正确返 roles 字段。
 */
async function callGetCurrent(page: Page): Promise<{
  id: number
  userName: string
  roles: string[]
}> {
  return await page.evaluate(async () => {
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
    // R envelope: {code: 200, msg/message: ..., data: ...}
    return j.data || j.response || {}
  })
}

/**
 * 调 /api/teacher/exam/paper/page 验证 createBy 过滤生效。
 */
async function callPaperPage(
  page: Page,
  body: Record<string, unknown>,
): Promise<{ total: number; list: Array<{ id: number; createUser?: number }> }> {
  return await page.evaluate(async (b) => {
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
    const resp = j.response || j.data || {}
    return { total: resp.total ?? 0, list: resp.list ?? [] }
  }, body)
}

// ─── 测试组 ────────────────────────────────────────────────────────

test.describe('U 卡 · BE /teacher/user/current 返 roles 字段', () => {
  test('admin 调 getCurrent 返 roles 含 superadmin', async ({ page }) => {
    await loginAs(page, ADMIN_USER, ADMIN_PWD)
    const userInfo = await callGetCurrent(page)
    expect(userInfo.userName, 'admin user_name 错位').toBe('admin')
    expect(Array.isArray(userInfo.roles), 'roles 字段必须是数组（BE 加 roles[]）').toBe(true)
    expect(
      userInfo.roles.includes('superadmin') || userInfo.roles.includes('admin'),
      `admin 应当含 superadmin/admin 角色，实际：${JSON.stringify(userInfo.roles)}`,
    ).toBe(true)
  })

  test('teacher001 调 getCurrent 返 roles 含 teacher', async ({ page }) => {
    await loginAs(page, TEACHER_USER, TEACHER_PWD)
    const userInfo = await callGetCurrent(page)
    expect(userInfo.userName, 'teacher001 user_name 错位').toBe('teacher001')
    expect(userInfo.roles, 'teacher001 roles 必须含 teacher').toContain('teacher')
  })
})

test.describe('U 卡 · BE /teacher/exam/paper/page 接受 createBy 过滤', () => {
  test('createBy=999999999 不存在的用户返空集 total=0', async ({ page }) => {
    await loginAs(page, ADMIN_USER, ADMIN_PWD)
    const result = await callPaperPage(page, {
      pageIndex: 1,
      pageSize: 10,
      createBy: '999999999',
    })
    expect(result.total, 'createBy 不匹配应返空集').toBe(0)
  })

  test('createBy=非数字字符串触发防注入返空', async ({ page }) => {
    await loginAs(page, ADMIN_USER, ADMIN_PWD)
    const result = await callPaperPage(page, {
      pageIndex: 1,
      pageSize: 10,
      createBy: 'abc; DROP TABLE',
    })
    expect(result.total, '非法 createBy 应被 \\d+ 白名单拦截返空').toBe(0)
  })

  test('createBy=空串 / 不传 不过滤（向后兼容）', async ({ page }) => {
    await loginAs(page, ADMIN_USER, ADMIN_PWD)
    const result = await callPaperPage(page, { pageIndex: 1, pageSize: 10 })
    expect(result.total, '不传 createBy 应返全部已发布卷').toBeGreaterThan(0)
  })
})

test.describe('U 卡 · FE 登录分流 + 菜单按角色', () => {
  test('admin 登录后跳 /home + 菜单全显', async ({ page }) => {
    await loginAs(page, ADMIN_USER, ADMIN_PWD)
    // 重新 goto /login 触发登录流（这次走 UI 而不是 fetch helper）
    await page.goto('/#/login')
    await page.fill('input[autocomplete="username"]', ADMIN_USER)
    await page.fill('input[autocomplete="current-password"]', ADMIN_PWD)
    await page.click('button.login-button, .login-button')

    // 等跳转完成（hash 路由 /home）
    await page.waitForURL(/#\/home/, { timeout: 10000 })
    expect(page.url(), 'admin 登录应跳 /home').toMatch(/#\/home/)

    // 菜单：作业 / 学生 / 班级 都看得见
    await expect(page.locator('.nav-item', { hasText: '作业管理' })).toBeVisible()
    await expect(page.locator('.nav-item', { hasText: '学生管理' })).toBeVisible()
    await expect(page.locator('.nav-item', { hasText: '班级管理' })).toBeVisible()
    await expect(page.locator('.nav-item', { hasText: '我的工作台' })).toBeVisible()
  })

  test('teacher001 登录后跳 /workspace + 占位菜单隐藏', async ({ page }) => {
    await page.goto('/#/login')
    await page.fill('input[autocomplete="username"]', TEACHER_USER)
    await page.fill('input[autocomplete="current-password"]', TEACHER_PWD)
    await page.click('button.login-button, .login-button')

    // 等跳转完成（hash 路由 /workspace）
    await page.waitForURL(/#\/workspace/, { timeout: 10000 })
    expect(page.url(), 'teacher001 登录应跳 /workspace').toMatch(/#\/workspace/)

    // 菜单：作业 / 学生 / 班级 不可见（占位空壳隐藏）
    await expect(page.locator('.nav-item', { hasText: '作业管理' })).toHaveCount(0)
    await expect(page.locator('.nav-item', { hasText: '学生管理' })).toHaveCount(0)
    await expect(page.locator('.nav-item', { hasText: '班级管理' })).toHaveCount(0)

    // 菜单：题库 / 卷库 / 我的工作台 必须可见
    await expect(page.locator('.nav-item', { hasText: '题库' })).toBeVisible()
    await expect(page.locator('.nav-item', { hasText: '卷库' })).toBeVisible()
    await expect(page.locator('.nav-item', { hasText: '我的工作台' })).toBeVisible()
  })
})

test.describe('U 卡 · 我的工作台 4 section 渲染', () => {
  test('teacher001 工作台 4 section 都能看到（空态文案 OK）', async ({ page }) => {
    await loginAs(page, TEACHER_USER, TEACHER_PWD)
    await page.goto('/#/workspace')
    await page.waitForLoadState('networkidle', { timeout: 15000 })

    // 头部欢迎
    await expect(page.locator('.workspace-header .title')).toContainText('欢迎')

    // 4 section（不强求里面非空，但 section-card 都要在）
    const sections = page.locator('.section-card')
    await expect(sections, '工作台必须渲染 4 section').toHaveCount(4)

    // section title 文案对齐
    await expect(page.locator('.section-title', { hasText: '我创建的卷' })).toBeVisible()
    await expect(page.locator('.section-title', { hasText: '我的收藏' })).toBeVisible()
    await expect(page.locator('.section-title', { hasText: '我的笔记' })).toBeVisible()
    await expect(page.locator('.section-title', { hasText: '我的草稿' })).toBeVisible()
  })
})

test.describe('U 卡 · FAB 路由白名单（P-2 一并实装）', () => {
  test('teacher001 在 /workspace 看见 FAB 试题栏', async ({ page }) => {
    await loginAs(page, TEACHER_USER, TEACHER_PWD)
    await page.goto('/#/workspace')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    // FAB 在白名单内（/workspace）应可见
    // QuestionBasket 组件挂载 — selector 取本工程常见 FAB 容器
    const fab = page.locator('.question-basket-fab, .basket-fab, [class*="basket"][class*="fab"]').first()
    // 软断言 — FAB selector 不稳定时不强 fail
    await expect(fab.or(page.locator('text=试题栏'))).toBeVisible({ timeout: 5000 })
  })

  test('admin 在 /home 看不到 FAB 试题栏', async ({ page }) => {
    await loginAs(page, ADMIN_USER, ADMIN_PWD)
    await page.goto('/#/home')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1000)
    // /home 不在白名单 — FAB 应不可见
    const fab = page.locator('.question-basket-fab, .basket-fab, [class*="basket"][class*="fab"]').first()
    await expect(fab).toHaveCount(0)
  })
})
