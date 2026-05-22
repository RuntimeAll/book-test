/**
 * H1 卡（book-admin 题目 CRUD）E2E 回归测试套 — V-11
 *
 * 覆盖 PRD §3 五端点 + §6 校验规则 的关键路径：
 *   1. 新建草稿（V-1 edit + V-6 五表同事务写）
 *   2. 详情拉取（V-5 select）
 *   3. 编辑更新（V-1 edit，status 不动）
 *   4. 发布（V-3 publish 0→1，已发布再发抛错）
 *   5. 软删（V-2 delete，无引用 OK；status='2' 再删幂等或拒绝按 BE 实现）
 *   6. 上传校验（V-4 fileUpload empty file → 500 文件不能为空）
 *
 * 设计：纯 Playwright APIRequest（不开浏览器，不需要 FE webServer），直接打 BE 7888。
 * 跟 v1-spec 不同 — v1 走 book-ui 4010 + BE 8080 + UI ctx 驱动。
 * 本套针对 book-admin 端，只验后端契约 + 数据状态机；FE UI 验收走手动 / 后续完善。
 *
 * 跑前置：
 *   1. BE 必须起：cd D:\workplace\book-ai\codeSpace2\book-server\ruoyi-admin && mvn spring-boot:run -Dspring-boot.run.profiles=dev
 *      （注意端口 7888，不是 8080；走 codeSpace2 master-admin 分支）
 *   2. DB miskt_data2 已就绪（admin 账号 + biz_subject 含 subjectId=3071001 浙教版数学）
 *
 * 跑：
 *   pnpm test:v15h               # headless
 *   pnpm test:v15h --grep CRUD   # 单组
 */
import { test, expect, request, APIRequestContext } from '@playwright/test'

// ─── 测试常量 ────────────────────────────────────────────────
const BE_BASE = 'http://localhost:7888'
const ADMIN_USER = 'admin'
const ADMIN_PWD = 'admin123'
const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'

// 已知有效 ID（V1 卡数据建模 W-6 修复后稳定存在）
const FIXTURE = {
  subjectId: '3071001',           // 浙教版数学（biz_subject level=2 教材根）
  knowledgeId: '3071001005003',   // 一个叶子知识点（biz_subject level=5）
}

// ─── 共用 helper ──────────────────────────────────────────────

let api: APIRequestContext
let token = ''
const createdQuestionIds: string[] = []  // ⚠️ 字符串保存 — Snowflake ID 19 位超 Number.MAX_SAFE_INTEGER (2^53)，JSON.parse 会精度丢

/** 从原始响应文本中按字段名抓取 id 字符串（避开 JSON.parse 精度丢）— 兼容裸数字和带引号字符串 */
function pickIdFromJsonText(text: string, key: string = 'id'): string | null {
  // BE 用 Jackson @JsonSerialize(using=ToStringSerializer.class) 把 Long 序列化为字符串
  // 所以响应是 "id":"2057854673884315649"，需要双向支持
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`))
  return m?.[1] ?? null
}

test.beforeAll(async () => {
  api = await request.newContext({
    baseURL: BE_BASE,
    extraHTTPHeaders: {
      clientid: CLIENT_ID,
      // ⚠️ Content-Type 不在全局头里设 — multipart 请求会被覆盖导致 BE 解析空 body
      // JSON 请求 Playwright `data: object` 自动设 application/json
    },
  })

  // 登录拿 token（注意 tenantId='000000'，否则 BE 抛"租户编号不能为空"）
  const loginResp = await api.post('/auth/login', {
    data: {
      username: ADMIN_USER,
      password: ADMIN_PWD,
      tenantId: '000000',
      clientId: CLIENT_ID,
      grantType: 'password',
    },
  })
  expect(loginResp.ok(), 'BE 7888 没起？检查 codeSpace2/book-server 是否在跑').toBeTruthy()
  const loginJson = await loginResp.json()
  expect(loginJson.code, `登录失败 msg=${loginJson.msg}`).toBe(200)
  token = loginJson.data?.access_token
  expect(token, 'access_token 为空').toBeTruthy()
})

test.afterAll(async () => {
  // 清场：把本套创建的题逐个软删（V-2 端点幂等性 BE 自行兜底）
  // biz_free_tag 字典残留留给结卡 sql/V*.sql 迁移清理
  for (const id of createdQuestionIds) {
    try {
      await api.post(`/admin/question/delete/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    } catch {
      // 静默 — afterAll 失败不影响测试结果
    }
  }
  await api.dispose()
})

function authHeaders() {
  return { Authorization: `Bearer ${token}` }
}

/** 构造一份合法的选择题 edit payload（用于新建场景）— PRD §6 R1-R10 全满足 */
function buildEditPayload(opts: { id?: string | null; stemSuffix?: string; difficult?: number; tags?: string[] } = {}) {
  // ⚠️ id 字段在 JSON 出去时如果是字符串，BE Java Long 反序列化会失败
  // 解决：用 raw JSON 字符串拼接，不走 object → JSON.stringify
  // 这里仍返回 object，调用方用 buildEditPayloadRaw 走字符串拼接
  return {
    id: opts.id ?? null,
    questionType: 1,
    difficult: opts.difficult ?? 2,
    subjectId: FIXTURE.subjectId,
    stemText: `[v15h-e2e] H1 卡回归测试题干 ${opts.stemSuffix ?? Date.now()}`,
    stemImgUrl: null,
    answerImgUrl: null,
    explainImgUrl: null,
    optionsJson: [
      { key: 'A', content: '选项 A' },
      { key: 'B', content: '选项 B' },
      { key: 'C', content: '选项 C' },
      { key: 'D', content: '选项 D' },
    ],
    correctAnswer: 'B',
    tagNames: opts.tags ?? ['v15h-自动测试'],
    questionKnowledges: [{ knowledgeId: FIXTURE.knowledgeId, source: 'U' }],
  }
}

// ─── 测试 cases ──────────────────────────────────────────────

test.describe.serial('H1 CRUD lifecycle — 新建 → 详情 → 编辑 → 发布 → 软删', () => {
  // ⚠️ 用字符串保存 qid — Snowflake 19 位超 Number.MAX_SAFE_INTEGER (2^53)
  // JSON.parse 走 Number 会精度丢（实际 ...238849 显示成 ...238800），导致 select-by-id 找不到
  let qid: string = ''

  test('case 1: V-1 新建草稿（5 表同事务写）', async () => {
    const resp = await api.post('/admin/question/edit', {
      headers: authHeaders(),
      data: buildEditPayload({ stemSuffix: 'case1-create' }),
    })
    expect(resp.ok()).toBeTruthy()
    const text = await resp.text()
    const code = JSON.parse(text).code
    expect(code, `edit 失败 body=${text.slice(0, 200)}`).toBe(200)
    const idStr = pickIdFromJsonText(text, 'id')
    expect(idStr, `新建返 id 为空 body=${text.slice(0, 200)}`).toBeTruthy()
    qid = idStr!
    createdQuestionIds.push(qid)
    console.log(`[v15h] case1 created qid=${qid}`)
  })

  test('case 2: V-5 详情 — 状态应为 0 草稿，5 表数据齐全', async () => {
    expect(qid, '前置 case1 未通过').toBeTruthy()
    const resp = await api.post(`/admin/question/select/${qid}`, { headers: authHeaders() })
    const text = await resp.text()
    const j = JSON.parse(text)
    expect(j.code, `select 失败 msg=${j.msg}`).toBe(200)
    const vo = j.data
    expect(vo, `select data 为空 — Snowflake id 精度丢？qid=${qid}`).toBeTruthy()
    expect(vo.status, '新建后 status 应为草稿 0').toBe('0')
    expect(vo.questionType).toBe(1)
    expect(vo.subjectId).toBe(FIXTURE.subjectId)
    expect(vo.correctAnswer).toBe('B')
    // 知识点 U 轨非空
    expect(Array.isArray(vo.questionKnowledges) && vo.questionKnowledges.length >= 1, '知识点关联为空').toBeTruthy()
  })

  test('case 3: V-1 编辑 — 改难度 + tagNames，status 应保持不动', async () => {
    expect(qid, '前置 case1 未通过').toBeTruthy()
    // raw JSON 拼接：把 "id":null 替换成 "id":<裸数字>，避免 JSON.stringify 把字符串 id 加引号导致 BE Long 反序列化失败
    const payload = buildEditPayload({ stemSuffix: 'case3-edit', difficult: 4, tags: ['v15h-编辑后', 'extra-tag'] })
    const rawBody = JSON.stringify(payload).replace('"id":null', `"id":${qid}`)
    const resp = await api.post('/admin/question/edit', {
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      data: rawBody,
    })
    const j = JSON.parse(await resp.text())
    expect(j.code, `edit 更新失败 msg=${j.msg}`).toBe(200)

    // 验：再次 select 看字段更新 + status 仍为 0
    const sel = await api.post(`/admin/question/select/${qid}`, { headers: authHeaders() })
    const vo = JSON.parse(await sel.text()).data
    expect(vo, '编辑后 select 仍找不到').toBeTruthy()
    expect(vo.difficult, '难度更新失败').toBe(4)
    expect(vo.status, '编辑后 status 不应被改动').toBe('0')
  })

  test('case 4: V-3 发布 — status 0→1', async () => {
    expect(qid, '前置 case1 未通过').toBeTruthy()
    const resp = await api.post(`/admin/question/publish/${qid}`, { headers: authHeaders() })
    const j = JSON.parse(await resp.text())
    expect(j.code, `publish 失败 msg=${j.msg}`).toBe(200)

    const sel = await api.post(`/admin/question/select/${qid}`, { headers: authHeaders() })
    const vo = JSON.parse(await sel.text()).data
    expect(vo.status, '发布后 status 应为 1').toBe('1')
  })

  test('case 5: V-3 重复发布 — 已发布再发布应拒绝（R-state-machine）', async () => {
    expect(qid, '前置 case1 未通过').toBeTruthy()
    const resp = await api.post(`/admin/question/publish/${qid}`, { headers: authHeaders() })
    const j = JSON.parse(await resp.text())
    // PRD §6 R8 状态机仅允许 0→1，已发布再发应抛 ServiceException → code:500
    expect(j.code, `已发布再发布应拒绝（code:500），实际 code=${j.code} msg=${j.msg}`).not.toBe(200)
  })

  test('case 6: V-2 软删 — 无 biz_paper_question 引用应通过，status 0/1→2', async () => {
    expect(qid, '前置 case1 未通过').toBeTruthy()
    const resp = await api.post(`/admin/question/delete/${qid}`, { headers: authHeaders() })
    const j = JSON.parse(await resp.text())
    expect(j.code, `delete 失败 msg=${j.msg}`).toBe(200)

    const sel = await api.post(`/admin/question/select/${qid}`, { headers: authHeaders() })
    const vo = JSON.parse(await sel.text()).data
    expect(vo.status, '软删后 status 应为 2').toBe('2')
  })
})

test.describe('H1 V-1 校验规则（PRD §6 R1-R7）', () => {
  test('R5: questionKnowledges 为空应拒绝', async () => {
    const bad = buildEditPayload({ stemSuffix: 'r5-empty-knowledges' })
    bad.questionKnowledges = []
    const resp = await api.post('/admin/question/edit', { headers: authHeaders(), data: bad })
    const j = await resp.json()
    expect(j.code, '知识点为空应拒绝').not.toBe(200)
    expect(j.msg, '错误消息应提示知识点').toMatch(/知识点|knowledge/)
  })

  test('R3: 选择题 correctAnswer 不在 options.keys 内应拒绝', async () => {
    const bad = buildEditPayload({ stemSuffix: 'r3-bad-answer' })
    bad.correctAnswer = 'Z'  // options 只有 A/B/C/D
    const resp = await api.post('/admin/question/edit', { headers: authHeaders(), data: bad })
    const j = await resp.json()
    expect(j.code, 'answer 不在 options 内应拒绝').not.toBe(200)
  })

  test('R-difficult-out-of-range: difficult=5 应拒绝（合法 1-4）', async () => {
    const bad = buildEditPayload({ stemSuffix: 'r-difficult-5', difficult: 5 })
    const resp = await api.post('/admin/question/edit', { headers: authHeaders(), data: bad })
    const j = await resp.json()
    expect(j.code, 'difficult 越界应拒绝').not.toBe(200)
  })
})

test.describe('H1 V-4 fileUpload 校验（不依赖 minio）', () => {
  test('empty file 应返 500 文件不能为空', async () => {
    // Playwright multipart 把 size=0 的 buffer 当合法附件传，不会本地报错
    const resp = await api.post('/admin/question/fileUpload', {
      headers: { Authorization: `Bearer ${token}`, clientid: CLIENT_ID },
      multipart: {
        type: 'stem',
        file: { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.from([]) },
      },
    })
    const j = await resp.json()
    expect(j.code, 'empty file 应被 BE 拒绝').toBe(500)
    expect(j.msg).toMatch(/上传文件不能为空|文件不能为空/)
  })

  test('未支持后缀 .bin 应返 500', async () => {
    const resp = await api.post('/admin/question/fileUpload', {
      headers: { Authorization: `Bearer ${token}`, clientid: CLIENT_ID },
      multipart: {
        type: 'stem',
        file: { name: 'mal.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('not-an-image') },
      },
    })
    const j = await resp.json()
    expect(j.code, '.bin 后缀应被拒绝').toBe(500)
    expect(j.msg).toMatch(/png|jpg|后缀|支持/)
  })
})
