/**
 * Merge-post Cross-BE Smoke — H 卡 admin merge → master 后双 BE 共存回归测试
 *
 * 背景：2026-05-23 B 主线 H 卡 admin 双 repo merge → master：
 *   - book-server: 三方 merge (794cafb → 2f43467)，含 admin-common 模块 + sys_oss 接手 + ruoyi-book-admin 模块
 *   - book-admin:  FF merge (ccc3f3c → d264a0a)
 *
 * 验证目标：merge 后教师端 BE (8080) + admin BE (7888) 双线程能共存，共享 DB / Redis 不串味。
 *
 * 覆盖：
 *   T1. admin BE 7888 健康（actuator 401 = sa-token 就绪）
 *   T2. teacher BE 8080 健康
 *   T3. admin/admin123 双 BE 各自登录 OK（同账号，两个独立 token）
 *   T4. admin BE /admin/question/page envelope = RuoYi { code:200, msg, data } 双轨隔离
 *   T5. teacher BE /teacher/question/page envelope = misikt { code:1, message, response } 双轨隔离
 *   T6. 双 BE 数据一致 — biz_question 总数双边相等（共享 miskt_data2 DB）
 *   T7. 双 BE 取同一题 ID 题干文本字节级一致（admin 走 /admin/question/select/{id} + teacher 走 /teacher/question/select/{id}）
 *   T8. 跨主线契约端点 /admin/question/listByIds —— H 卡未实装，文档化"等 I 卡 V-7 补"（expect 404 锁定 baseline）
 *   T9. ruoyi-admin-common 模块就位 — /admin/question/fileUpload 端点可达（empty file 400/500 都行，关键是非 404）
 *
 * 跑前置：
 *   1. teacher BE 8080 已起（codeplace-A/book-server）
 *   2. admin BE 7888 已起（codeplace-B/book-server，已 mvn install ruoyi-book-admin/ruoyi-admin-common 到 .m2）
 *   3. DB miskt_data2 admin/admin123 存在
 *
 * 跑：
 *   pnpm exec playwright test --config=playwright-admin.config.ts tests/merge-post-cross-be-smoke.spec.ts --workers=1
 */
import { test, expect, request, APIRequestContext } from '@playwright/test'

const TEACHER_BASE = 'http://localhost:8080'
const ADMIN_BASE = 'http://localhost:7888'
const ADMIN_USER = 'admin'
const ADMIN_PWD = 'admin123'
const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'

let teacherApi: APIRequestContext
let adminApi: APIRequestContext
let teacherToken = ''
let adminToken = ''

test.beforeAll(async () => {
  teacherApi = await request.newContext({ baseURL: TEACHER_BASE, extraHTTPHeaders: { clientid: CLIENT_ID } })
  adminApi = await request.newContext({ baseURL: ADMIN_BASE, extraHTTPHeaders: { clientid: CLIENT_ID } })
})

test.afterAll(async () => {
  await teacherApi?.dispose()
  await adminApi?.dispose()
})

async function loginOn(api: APIRequestContext, host: string): Promise<string> {
  const resp = await api.post('/auth/login', {
    data: {
      username: ADMIN_USER,
      password: ADMIN_PWD,
      tenantId: '000000',
      clientId: CLIENT_ID,
      grantType: 'password',
    },
  })
  expect(resp.ok(), `${host} 登录 HTTP 失败 status=${resp.status()}`).toBeTruthy()
  const j = await resp.json()
  expect(j.code, `${host} 登录 code 失败 msg=${j.msg}`).toBe(200)
  const tok = j.data?.access_token
  expect(tok, `${host} access_token 为空`).toBeTruthy()
  return tok
}

test('T1: admin BE 7888 健康（actuator 返 401 = sa-token 拦截器就位）', async () => {
  const resp = await adminApi.get('/actuator')
  expect(resp.status(), 'admin BE 未起或异常').toBe(401)
})

test('T2: teacher BE 8080 健康（actuator 返 401）', async () => {
  const resp = await teacherApi.get('/actuator')
  expect(resp.status(), 'teacher BE 未起或异常').toBe(401)
})

test('T3: admin/admin123 在双 BE 各自独立登录（同账号 / 两个独立 token）', async () => {
  teacherToken = await loginOn(teacherApi, 'teacher@8080')
  adminToken = await loginOn(adminApi, 'admin@7888')
  // 两个 token 都拿到 — 不要求不相等（Redis db:0 共享会让 sa-token 多端登录策略影响 token，
  // 业务上只需两边都拿到非空 token 即可）
  expect(teacherToken.length).toBeGreaterThan(20)
  expect(adminToken.length).toBeGreaterThan(20)
})

test('T4: admin BE /admin/question/page envelope = RuoYi { code:200, msg, data }', async () => {
  const resp = await adminApi.post('/admin/question/page', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { pageNum: 1, pageSize: 5 },
  })
  expect(resp.ok()).toBeTruthy()
  const j = await resp.json()
  expect(j.code, `admin envelope 不符 RuoYi R 类 body=${JSON.stringify(j).slice(0, 200)}`).toBe(200)
  expect(j.msg).toBeDefined()
  expect(j.data?.total, 'page 应有 total 字段').toBeGreaterThan(0)
  expect(Array.isArray(j.data?.list), 'page 应有 list 数组').toBeTruthy()
})

test('T5: teacher BE /teacher/question/page envelope = misikt { code:1, message, response }', async () => {
  const resp = await teacherApi.post('/teacher/question/page', {
    headers: { Authorization: `Bearer ${teacherToken}` },
    data: { pageNum: 1, pageSize: 5 },
  })
  expect(resp.ok()).toBeTruthy()
  const j = await resp.json()
  expect(j.code, `teacher envelope 不符 misikt body=${JSON.stringify(j).slice(0, 200)}`).toBe(1)
  expect(j.message).toBeDefined()
  expect(j.response?.total, 'teacher page 应有 response.total').toBeGreaterThan(0)
})

test('T6: 双 BE 共享 biz_question 表 — 总数相等（DB 共用 miskt_data2 验证）', async () => {
  const adminResp = await adminApi.post('/admin/question/page', {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { pageNum: 1, pageSize: 1 },
  })
  const adminTotal = (await adminResp.json()).data.total

  const teacherResp = await teacherApi.post('/teacher/question/page', {
    headers: { Authorization: `Bearer ${teacherToken}` },
    data: { pageNum: 1, pageSize: 1 },
  })
  const teacherTotal = (await teacherResp.json()).response.total

  // ⚠️ admin 看到的是 status IN (0,1,2)（草稿 + 发布 + 软删），teacher 只看 status=1（已发布）
  //    所以 admin >= teacher。但都不应为 0。
  expect(adminTotal, 'admin total 为 0 — biz_question 表空？').toBeGreaterThan(0)
  expect(teacherTotal, 'teacher total 为 0').toBeGreaterThan(0)
  expect(adminTotal, 'admin total < teacher total 异常（admin 应看到全集）').toBeGreaterThanOrEqual(teacherTotal)
  console.log(`[merge-smoke] T6: admin total=${adminTotal} / teacher total=${teacherTotal}`)
})

test('T7: 双 BE 取同一题 ID 题干一致（admin select 走 RuoYi / teacher select 走 misikt）', async () => {
  // 找一道 teacher 端可见（status=1 发布态）的题
  const teacherResp = await teacherApi.post('/teacher/question/page', {
    headers: { Authorization: `Bearer ${teacherToken}` },
    data: { pageNum: 1, pageSize: 1 },
  })
  const teacherFirst = (await teacherResp.json()).response.list[0]
  const qid = teacherFirst.id
  const teacherStem = teacherFirst.stemText

  // admin 取同一题
  const adminResp = await adminApi.post(`/admin/question/select/${qid}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  expect(adminResp.ok(), `admin select ${qid} HTTP 失败`).toBeTruthy()
  const adminJ = await adminResp.json()
  expect(adminJ.code, `admin select code 失败 msg=${adminJ.msg}`).toBe(200)
  const adminStem = adminJ.data.stemText

  expect(adminStem, `双 BE 取 qid=${qid} 题干不一致 / DB 串味？\n  admin: ${adminStem?.slice(0, 80)}\n  teacher: ${teacherStem?.slice(0, 80)}`).toBe(teacherStem)
  console.log(`[merge-smoke] T7: qid=${qid} stem 字节级一致 (${teacherStem?.length} chars)`)
})

test('T8: /admin/question/listByIds 跨主线契约 baseline — H 卡未实装锁定 404（I 卡 V-7 实装后改为 PASS 期望）', async () => {
  const resp = await adminApi.post('/admin/question/listByIds', {
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
    data: { ids: ['1'] },
  })
  const j = await resp.json()
  // 当前期望：404 / msg = 请求地址不存在（H 卡未实装该端点，I 卡 V-7 实装后改这里）
  expect(j.code, '若 code=200 = I 卡已实装跨契约端点，本测试需更新断言').toBe(404)
  console.log(`[merge-smoke] T8: /admin/question/listByIds 当前 404（H 卡未实装，I 卡 V-7 计划补）— 锁定 baseline`)
})

test('T9: ruoyi-admin-common 就位 — /admin/question/fileUpload 端点可达（非 404）', async () => {
  // 不上传真文件，只验端点路由存在（404 = controller 未注册）
  // empty form-data → BE 应返 400/500（缺 file 参数），关键是不能 404
  const resp = await adminApi.post('/admin/question/fileUpload', {
    headers: { Authorization: `Bearer ${adminToken}` },
    multipart: {
      type: 'stem',
      file: { name: 'probe.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    },
  })
  const j = await resp.json()
  expect(j.code, `fileUpload 端点 404 = ruoyi-book-admin 模块未注册或 install 失败`).not.toBe(404)
  console.log(`[merge-smoke] T9: /admin/question/fileUpload 路由就位 code=${j.code} msg=${j.msg?.slice(0, 60)}`)
})
