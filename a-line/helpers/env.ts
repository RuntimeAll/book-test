/**
 * tests/helpers/env.ts — 环境切换单一事实源
 *
 * 用法：
 *   import { IS_PROD, BASE_URL, TEACHER, ADMIN, CLIENT_ID } from '../helpers/env'
 *
 * 切换：
 *   TEST_ENV=local (默认) — 本地开发, webServer 起 vite:4010, BE 8080
 *   TEST_ENV=prod         — 打 http://www.jpjia.cn，local-only spec 会被 test.skip 守卫跳过
 *
 * 账号均可经 env 覆盖（prod 真凭据不写死进 repo）：
 *   TEACHER_USER / TEACHER_PWD
 *   ADMIN_USER   / ADMIN_PWD
 */

const TEST_ENV = process.env.TEST_ENV ?? 'local'

export const IS_PROD: boolean = TEST_ENV === 'prod'

const FE_PORT = Number(process.env.FE_PORT ?? 4010)

export const BASE_URL: string = IS_PROD
  ? 'http://www.jpjia.cn'
  : `http://localhost:${FE_PORT}`

/** teacher 角色账号（dev: teacher001 / 666666） */
export const TEACHER = {
  user: process.env.TEACHER_USER ?? 'teacher001',
  pwd:  process.env.TEACHER_PWD  ?? '666666',
} as const

/** superadmin 账号（dev: admin / admin123） */
export const ADMIN = {
  user: process.env.ADMIN_USER ?? 'admin',
  pwd:  process.env.ADMIN_PWD  ?? 'admin123',
} as const

/** book-ui 登录时的 clientId（不含密钥，不敏感） */
export const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'
