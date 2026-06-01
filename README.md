# book-test — misikt 教师端复刻 · 跨栈 E2E 回归测试

跟 `book-server`（BE）/ `book-ui`（FE）平级的独立 test repo。统一收纳：
- FE-only UI 行为
- BE-only 接口契约
- 全栈端到端业务流
- 0 misikt 请求验证 / SQL 注入防护等安全 / 数据契约校验

未来加新测试都进这里 — **测试代码不污染 FE/BE 业务 repo**。

---

## 一、目录

```
book-test/
├── playwright.config.ts          # Chrome路径 / webServer 起 book-ui vite / baseURL
├── package.json                  # Playwright 1.60 + ts
├── tsconfig.json
├── .gitignore                    # node_modules / playwright-report / test-results
├── tests/
│   ├── v1-question-bank-regression.spec.ts   # V1 卡 11 用例
│   └── (未来新 spec)
└── README.md
```

---

## 二、跑测试

### 1. 前置（一次性）

**Chrome for Testing**（强烈推荐）

`playwright.config.ts` 默认走 `D:/workplace/workTool/chrome-win64/chrome.exe`。
不同路径用环境变量：

```powershell
$env:LOCAL_CHROME='C:/path/to/chrome.exe'
```

不想用本地 Chrome → 删 `playwright.config.ts` 里 `launchOptions.executablePath` + 跑：

```powershell
pnpm exec playwright install chromium
```

**装依赖**

```powershell
cd D:\workplace\book-ai\codeplace-O\book-test
pnpm install
```

### 2. 跑前必备 — 后端 + 数据库

**BE 必须先手动起**（webServer 只自动起 FE，不起 BE）：

```powershell
cd D:\workplace\book-ai\codeplace-A\book-server\ruoyi-admin
mvn spring-boot:run
# 等到 "Started DromaraApplication" 再回来跑测试
```

健康检查：`Invoke-RestMethod http://localhost:8080/actuator` → 返 401（被 sa-token 拦下 = BE 起来了）

**DB miskt_data2** 必须已落 W-6 修复：
- `biz_subject` ≥ 2116 行 / 占位名 0
- `biz_question_knowledge` ≥ 29529 行
- `admin / admin123` 账号存在（RuoYi 默认）

验证：
```sql
SELECT COUNT(*) FROM biz_subject;                          -- ≥ 2116
SELECT COUNT(*) FROM biz_subject WHERE name LIKE '节点 %';   -- 0
```

### 3. 跑

```powershell
cd D:\workplace\book-ai\codeplace-O\book-test

# 跑 V1 全部 11 用例（headless，~25s）
pnpm test:v1

# 想看浏览器跑
pnpm test:v1:headed

# 只跑某组
pnpm test:v1 --grep "BUG-2"
pnpm test:v1 --grep "UI 全链路"

# 跑所有 spec
pnpm test

# 跑完看 HTML 报告
pnpm report
```

### 4. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TEST_ENV` | `local` | 切换运行环境：`local`（本地，起 vite + BE 8080）/ `prod`（打 http://www.jpjia.cn，local-only spec 自动 skip，不起 webServer） |
| `LOCAL_CHROME` | `D:/workplace/workTool/chrome-win64/chrome.exe` | 本地 Chrome 路径 |
| `BOOK_UI_PATH` | `../../codeplace-A/book-ui`（相对 playwright.config.ts） | book-ui 工程绝对路径，webServer cwd 用 |
| `FE_PORT` | `4010` | FE dev server 端口（webServer 起这个；TEST_ENV=prod 时无效） |
| `HEADED` | unset = headless | 设 `1` 显示浏览器 |
| `CI` | unset | 设了 `reuseExistingServer=false`，每次新起 FE |
| `TEACHER_USER` | `teacher001` | 覆盖教师账号（prod 真凭据不进 repo） |
| `TEACHER_PWD` | `666666` | 覆盖教师密码 |
| `ADMIN_USER` | `admin` | 覆盖管理员账号 |
| `ADMIN_PWD` | `admin123` | 覆盖管理员密码 |

**切换示例**：
```powershell
# 默认 local（本地全套回归）
pnpm test

# prod 干跑（验 config + local-only skip；不实打 prod BE）
$env:TEST_ENV='prod'; pnpm test; $env:TEST_ENV='local'
```

---

## 三、测试套清单

### `v1-question-bank-regression.spec.ts`（11 用例，~25s）

V1 卡（题库去原网站化）完工后的回归测试。

**BE 端口契约组**（直接 fetch / api，覆盖 vite proxy + BE 端到端）
- Bug C — 难度 `difficult` 字段对齐（旧 FE 传 `difficulty` 完全失效）
- 题型 `questionType=1` 选择题命中
- Bug D — 关键词中文筛选（axios UTF-8）
- **BUG-2 真修** — `subjectId` 走 `biz_question_knowledge` JOIN（3071/3072/3010001 都应有题）
- SQL 注入防护 — 非法 subjectId 返空集
- Bug A — `POST /cancel/{id}` 返 `code:1`
- Bug A 反例 — 旧错路径 `/removeBasket/{id}` 应返 404

**UI 全链路组**（直接驱动 Vue ctx）
- 筛选 UI — 难度 / 题型 / 关键词 → 验 `ctx.total`
- 章节树点击 — `handleNodeClick({id:'3072'})` → 列表有题
- Bug A — `handleBasketToggle` 加/移无 ElMessage error

**核心目标组**
- 整会话 0 个 `misikt.com` 请求（page.on('request') 监听）

---

## 四、写新测试

### 文件命名

- 回归：`<卡号>-<模块>-regression.spec.ts`（如 `v1-question-bank-regression.spec.ts`）
- 业务流：`<卡号>-<场景>.spec.ts`
- 烟雾：`smoke-<功能>.spec.ts`
- BE-only 契约：`api-<模块>.spec.ts`

### 数据断言原则

题库数据会随时间增长。所有 `expect(total).toBe(N)` 都改成 `>=` 区间：

```ts
const EXPECTED_MIN = { TOTAL_ALL: 29000, ... }
expect(total).toBeGreaterThanOrEqual(EXPECTED_MIN.TOTAL_ALL)
```

### 登录 helper

复用 `loginAsAdmin(page)`：直接打 `/api/auth/login` 拿 token 存 localStorage，**不走 UI 点击**（更稳）。

### Vue ctx 直接驱动 helper

```ts
async function findCtx(page) {
  return await page.evaluate(() => {
    for (const el of document.querySelectorAll('.el-input')) {
      // @ts-expect-error
      let c = el.__vueParentComponent
      while (c) {
        const ctx = c.setupState || c.ctx
        if (ctx && ctx.filter && 'difficulty' in ctx.filter) return ctx
        c = c.parent
      }
    }
  })
}
```

调 `ctx.onSearch()` / `ctx.handleNodeClick()` 直接驱动业务逻辑 — 跳过 Element-Plus DOM 操作的不稳定（select 下拉、tree 节点点击等）。

### 等待策略

**不要用 `networkidle`** — vite HMR + lazyTree 长期不 idle。

用关键 selector 替代：

```ts
await page.waitForSelector('.el-select, .question-list, .el-empty', { timeout: 15000 })
await page.waitForTimeout(1000)
```

---

## 五、CI（暂未配）

未来上 CI 时：
1. 装 Chrome：`pnpm exec playwright install --with-deps chromium`
2. 起 BE 服务（mysql + spring-boot:run）— 单独 service
3. 跑：`CI=1 pnpm test:v1`

---

## 六、已知坑

| 坑 | 表现 | 解 |
|---|---|---|
| BE 没起 | 第一个 test fail "登录失败" | 看 §二.2 |
| DB 未跑 W-6 | 章节 3072/3010001 test fail（0 题）| 跑 `workplace/数据建模/07-补充资料/W-6-fix.sql` |
| 4010 端口被占 | webServer 自动换端口，baseURL 错 | `$env:FE_PORT='4011'` 重设 |
| Chrome 路径不对 | "executable doesn't exist" | `$env:LOCAL_CHROME='...'` 或注释掉 launchOptions |
| pnpm dev 启不来 | webServer timeout | book-ui 那边 `Remove-Item -Recurse node_modules\.vite` 清缓存 |
| token 写了但还跳登录 | UI 链路组 fail "vm 未挂载" | `gotoQuestionIndex` 已加 reload，确保用最新代码 |

---

## 七、相关文档

- `workplace/PRD/2026-05-21-V1-card-review/` — V1 卡验收报告 + 截图
- `workplace/数据建模/07-补充资料/W-6-章节树数据复刻方案-2026-05-21.md` — BUG-2 根因 + 修复
- `workplace/数据建模/本次操作总清单-2026-05-21.md` — DB 改动总单
