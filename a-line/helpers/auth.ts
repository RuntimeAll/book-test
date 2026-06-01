/**
 * tests/helpers/auth.ts — 统一登录 helper
 *
 * 用法：
 *   import { loginByApi } from '../helpers/auth'
 *   await loginByApi(page, 'teacher')   // 注入 token + reload
 *   await loginByApi(page, 'admin')
 *
 * 设计：
 *   - 页面内 page.evaluate 走 fetch('/api/auth/login') 拿 token
 *   - 写 localStorage['book-ui:auth']（字段结构与各 spec 原有副本一致，不改字段名）
 *   - 函数内部调 page.reload() + 等 domcontentloaded（samesite pinia store 重 init 拿到 token）
 *   - 返回 access_token 供直接 fetch 调 BE（可选使用）
 *
 * 登录铁则（PRD-A-001 沉淀）：
 *   写完 localStorage 后必须 page.reload() 整页刷；
 *   仅改 hash 会被 router guard 踢回 /login。
 */

import { expect, type Page } from '@playwright/test'
import { TEACHER, ADMIN, CLIENT_ID } from './env'

type Who = 'teacher' | 'admin'

/**
 * 以任意凭据登录（用于动态账号测试，如注册后用新账号登录）。
 * 内部已完成 localStorage 写入 + page.reload() + domcontentloaded 等待。
 */
export async function loginByCredentials(page: Page, user: string, pwd: string): Promise<string> {
  await page.goto('/#/login')
  await page.waitForLoadState('domcontentloaded')

  const token = await page.evaluate(
    async ({ u, p, cid }) => {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: u,
          password: p,
          clientId: cid,
          grantType: 'password',
          tenantId: '000000',
        }),
      })
      const j = await resp.json()
      const data = j.data || {}
      const auth = {
        scope:             data.scope            ?? null,
        openid:            data.openid           ?? null,
        access_token:      data.access_token,
        refresh_token:     data.refresh_token,
        expire_in:         data.expire_in,
        refresh_expire_in: data.refresh_expire_in,
        client_id:         cid,
      }
      localStorage.setItem('book-ui:auth', JSON.stringify(auth))
      return data.access_token as string
    },
    { u: user, p: pwd, cid: CLIENT_ID },
  )

  expect(token, `loginByCredentials(${user}) 失败`).toBeTruthy()

  await page.reload()
  await page.waitForLoadState('load')
  await page.waitForTimeout(300)

  return token
}

/**
 * 登录并返回 access_token。
 * 内部已完成 localStorage 写入 + page.reload() + domcontentloaded 等待。
 * 调用方无需再 reload，直接 page.goto 业务页即可。
 */
export async function loginByApi(page: Page, who: Who): Promise<string> {
  const creds = who === 'teacher' ? TEACHER : ADMIN

  await page.goto('/#/login')
  await page.waitForLoadState('domcontentloaded')

  const token = await page.evaluate(
    async ({ user, pwd, cid }) => {
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
        scope:            data.scope            ?? null,
        openid:           data.openid           ?? null,
        access_token:     data.access_token,
        refresh_token:    data.refresh_token,
        expire_in:        data.expire_in,
        refresh_expire_in: data.refresh_expire_in,
        client_id:        cid,
      }
      localStorage.setItem('book-ui:auth', JSON.stringify(auth))
      return data.access_token as string
    },
    { user: creds.user, pwd: creds.pwd, cid: CLIENT_ID },
  )

  expect(
    token,
    `loginByApi(${who}) 失败 — ${creds.user} 账号是否存在？BE 8080 是否起？`,
  ).toBeTruthy()

  // 整页刷：让 pinia store 重 init 读到 LS token，否则 router guard 仍 isLoggedIn=false
  await page.reload()
  // 等 load 而不是 domcontentloaded，确保 Vue app + router guard 完整执行完再返回
  await page.waitForLoadState('load')
  // 额外短暂等待让 router 跳转完成（router guard 可能在 load 后异步执行）
  await page.waitForTimeout(300)

  return token
}
