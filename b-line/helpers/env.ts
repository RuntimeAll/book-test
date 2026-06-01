/**
 * b-line/helpers/env.ts — B 线（book-admin）环境切换单一事实源
 *
 * 用法：
 *   import { IS_PROD, ADMIN, CLIENT_ID } from '../helpers/env'
 *
 * B 线本阶段不接 TEST_ENV prod 切换（后续卡处理）。
 * 账号均可经 env 覆盖：
 *   ADMIN_USER / ADMIN_PWD
 */

const TEST_ENV = process.env.TEST_ENV ?? 'local'

export const IS_PROD: boolean = TEST_ENV === 'prod'

/** superadmin 账号（dev: admin / admin123） */
export const ADMIN = {
  user: process.env.ADMIN_USER ?? 'admin',
  pwd:  process.env.ADMIN_PWD  ?? 'admin123',
} as const

/** book-ui / book-admin 登录时的 clientId（不含密钥，不敏感） */
export const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'
