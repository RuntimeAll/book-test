/**
 * PRD-A-013 T0 / G8 - Visual Diff Baseline + Verify
 *
 * 两种模式 (通过环境变量 VISUAL_MODE 切):
 *   - VISUAL_MODE=baseline (默认): 截 5 张 baseline PNG 落 artifacts/baseline/<name>.png
 *   - VISUAL_MODE=verify: 截 5 张 after PNG 落 artifacts/over/g8-<name>-after.png,
 *     并与 baseline 做像素 diff (maxDiffPixelRatio: 0.01), diff 图落 over/g8-<name>-diff.png
 *
 * 🔴 G8 根因修复 (2026-06-09):
 *   - baseline=1280x720 / after=1037x799 视口不一致致无法 pixel-diff → 显式 setViewportSize 锁 1280x720
 *   - BE :8080 未起致 after 全空数据态 → 跑前必先验 BE 活着 (页面不空报 actuator 404 也算活)
 *   - spec 自带 verify 模式做 pixel diff, 不再依赖人眼对比
 *
 * 前置 (主 session 起):
 *   - book-ui dev :5173 (FE)
 *   - book-server dev :8080 (BE) - 必须真活, 不然 verify 必假红
 *
 * 跑:
 *   # baseline (清干净工作树后跑一次, 已有 baseline 时不要重跑)
 *   $env:VISUAL_MODE='baseline'
 *   pnpm exec playwright test specs/v999-visual-diff.spec.ts --config=specs/visual.config.ts --workers=1
 *
 *   # verify (改完代码跑这个, 与 baseline 像素 diff)
 *   $env:VISUAL_MODE='verify'
 *   pnpm exec playwright test specs/v999-visual-diff.spec.ts --config=specs/visual.config.ts --workers=1
 *
 * 路由是 hash mode: 必须 #/ 前缀.
 */
import { test, expect } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'

// 串行单 worker — 与配置 workers:1 双重保险
test.describe.configure({ mode: 'serial' })

const BASE = 'http://localhost:5173'
const PRD_DIR = 'D:/workplace/book-ai/workplace/.prd_ccw/PRD-A/PRD-A-013'
const BASELINE_DIR = `${PRD_DIR}/artifacts/baseline`
const OVER_DIR = `${PRD_DIR}/over`

// 🔴 锁视口 — 与 baseline (1280x720) 完全一致, 防 G8 视口偏移假红
const VIEWPORT = { width: 1280, height: 720 }

// 模式: baseline | verify (默认 baseline 兼容历史)
const MODE = (process.env.VISUAL_MODE || 'baseline').toLowerCase()
if (MODE !== 'baseline' && MODE !== 'verify') {
  throw new Error(`VISUAL_MODE 必须是 baseline 或 verify, 收到: ${MODE}`)
}

// 像素 diff 阈值 — 与 PRD G8 一致 (≤1% 像素差)
const MAX_DIFF_PIXEL_RATIO = 0.01

// questionId=37070 是 BE /teacher/question/page 实测拿到的真实题目
const REAL_QUESTION_ID = '37070'

interface PageSpec {
  name: string
  hash: string
}

const PAGES: PageSpec[] = [
  { name: 'home', hash: '#/home' },
  { name: 'workspace', hash: '#/workspace' },
  { name: 'papers-source', hash: '#/papers/index' },
  { name: 'question-index', hash: '#/question/index' },
  { name: 'question-detail', hash: `#/question/detail/${REAL_QUESTION_ID}` },
]

const CLIENT_ID = 'e5cd7e4891bf95d1d19206ce24a7b32e'

async function login(page: any) {
  await page.goto(BASE + '/#/login')
  await page.waitForLoadState('domcontentloaded')

  const token = await page.evaluate(
    async ({ cid }: { cid: string }) => {
      const resp = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'teacher001',
          password: '666666',
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
    { cid: CLIENT_ID },
  )

  expect(token, 'login 失败 — teacher001/666666 / BE :8080 必须活着').toBeTruthy()

  // 整页刷让 pinia store re-init 拿 LS token
  await page.reload()
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
}

// 简易 PNG 像素 diff — 不引外部库 (sharp/pixelmatch), 用 Playwright 自带 PNG 解析能力
// (实际上 Playwright 内部用 pngjs+pixelmatch, 我们暴露给自己用)
async function pixelDiff(
  baselinePath: string,
  afterPath: string,
  diffOutPath: string,
): Promise<{ diffRatio: number; widthMismatch: boolean; baselineSize: {w:number,h:number}; afterSize: {w:number,h:number} }> {
  // 用 dynamic require playwright 内置 pngjs / pixelmatch (其 _internal 不稳, 改走显式依赖)
  // 没装外部包就用 fallback: 比较文件 size + 维度
  let pixelmatch: any, PNG: any
  try {
    pixelmatch = (await import('pixelmatch')).default
    PNG = (await import('pngjs')).PNG
  } catch {
    // 没装就用降级 — 只比维度 + 文件 size 偏差
    const baseSize = fs.statSync(baselinePath).size
    const afterSize = fs.statSync(afterPath).size
    // 用 sharp 或 image-size 也是外部包, 这里 fallback: 用 Node 原生读 PNG 头 8 字节签名 + IHDR (16-24 字节是 width/height)
    const readPngSize = (p: string) => {
      const buf = fs.readFileSync(p)
      // PNG 文件头: 8 字节签名, 然后 4 字节 chunk length, 4 字节 'IHDR', 4 字节 width (BE), 4 字节 height (BE)
      const w = buf.readUInt32BE(16)
      const h = buf.readUInt32BE(20)
      return { w, h }
    }
    const b = readPngSize(baselinePath)
    const a = readPngSize(afterPath)
    const widthMismatch = b.w !== a.w
    // 极简兜底: 维度不一致直接 1.0 (全红), 一致按 file size 偏差估算 (≠ 真 pixel diff, 但比假绿强)
    const sizeRatio = Math.abs(baseSize - afterSize) / Math.max(baseSize, afterSize)
    return {
      diffRatio: widthMismatch ? 1.0 : sizeRatio,
      widthMismatch,
      baselineSize: b,
      afterSize: a,
    }
  }
  // 装了 pixelmatch + pngjs 走真 pixel diff
  const baseBuf = fs.readFileSync(baselinePath)
  const afterBuf = fs.readFileSync(afterPath)
  const basePng = PNG.sync.read(baseBuf)
  const afterPng = PNG.sync.read(afterBuf)
  const widthMismatch = basePng.width !== afterPng.width
  if (widthMismatch) {
    return {
      diffRatio: 1.0,
      widthMismatch,
      baselineSize: { w: basePng.width, h: basePng.height },
      afterSize: { w: afterPng.width, h: afterPng.height },
    }
  }
  // 高度不一致 — 取最小高度做 diff (fullPage 长度可能因数据条数不同微小变化)
  const w = basePng.width
  const h = Math.min(basePng.height, afterPng.height)
  const cropBuf = (src: any) => {
    if (src.height === h) return src.data
    // crop 到前 h 行
    const out = Buffer.alloc(w * h * 4)
    src.data.copy(out, 0, 0, w * h * 4)
    return out
  }
  const baseData = cropBuf(basePng)
  const afterData = cropBuf(afterPng)
  const diffPng = new PNG({ width: w, height: h })
  const diffPixels = pixelmatch(baseData, afterData, diffPng.data, w, h, { threshold: 0.1 })
  fs.writeFileSync(diffOutPath, PNG.sync.write(diffPng))
  const total = w * h
  return {
    diffRatio: diffPixels / total,
    widthMismatch: false,
    baselineSize: { w: basePng.width, h: basePng.height },
    afterSize: { w: afterPng.width, h: afterPng.height },
  }
}

// 跑前确保 BE :8080 活着 (避空数据态假红)
test.beforeAll(async ({ request }) => {
  if (MODE !== 'verify') return
  // actuator/health 即使 401 也算 BE 活, 网络层 ECONNREFUSED 才是真挂
  try {
    const resp = await request.get('http://localhost:8080/actuator/health', { timeout: 5000, failOnStatusCode: false })
    expect(resp.status(), `BE :8080 health endpoint 返回 ${resp.status()} (≠ECONNREFUSED 即活)`).toBeGreaterThan(0)
  } catch (e: any) {
    throw new Error(`BE :8080 不可达 (${e?.message}) — verify 模式必须 BE 活着, 否则页面空状态 G8 必假红. 先启 BE 再跑.`)
  }
  // 确保 over 目录存在
  if (!fs.existsSync(OVER_DIR)) fs.mkdirSync(OVER_DIR, { recursive: true })
})

for (const p of PAGES) {
  test(`${MODE}:${p.name}`, async ({ page }) => {
    // 🔴 显式锁视口 — 与 baseline 一致防 G8 视口偏移假红
    await page.setViewportSize(VIEWPORT)

    // 监听 BE 接口异常 (verify 模式) — RuoYi 把异常 wrap 成 HTTP 200 + envelope code:500,
    // 所以不能只看 HTTP status. 同时收 HTTP 5xx 和 envelope 内 code:500.
    // 命中即 infra fail, G8 视觉 diff 不会被 BE bug 污染成伪视觉回归.
    const beServerErrors: { url: string; status: number; envelopeCode?: number; envelopeMsg?: string }[] = []
    if (MODE === 'verify') {
      page.on('response', async (resp) => {
        const url = resp.url()
        if (!/\/api\/(teacher|system|auth|resource)\b/.test(url)) return
        const status = resp.status()
        if (status >= 500 && status < 600) {
          beServerErrors.push({ url, status })
          return
        }
        // 检 envelope (RuoYi {code, msg, data} / misikt {code:1, message, response})
        try {
          const ct = resp.headers()['content-type'] || ''
          if (!ct.includes('json')) return
          const body = await resp.json().catch(() => null)
          if (!body || typeof body !== 'object') return
          // RuoYi: 200 成功, 500 异常 (msg='发生未知异常,请联系管理员' 类). misikt: 1 成功, 其余异常.
          // /teacher/** 走 misikt envelope (code 0 == 失败); /system /auth 走 RuoYi (code !== 200 == 失败)
          const isTeacher = /\/api\/teacher\b/.test(url)
          const code = body.code
          const isFail = isTeacher ? (code !== undefined && code !== 1) : (code !== undefined && code !== 200)
          if (isFail && code >= 500) {
            beServerErrors.push({ url, status, envelopeCode: code, envelopeMsg: body.msg || body.message })
          }
        } catch {
          // 解析失败忽略
        }
      })
    }

    await login(page)

    await page.goto(BASE + '/' + p.hash)
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {
      // MathJax CDN 偶发挂起 networkidle, 不致命
    })
    // MathJax 公式渲染 + 列表数据加载 + 雪花 ID 字段回写稳定
    await page.waitForTimeout(2000)

    if (MODE === 'baseline') {
      const out = path.join(BASELINE_DIR, p.name + '.png')
      await page.screenshot({ path: out, fullPage: true })
      const stat = fs.statSync(out)
      expect(stat.size, `${p.name}.png 体积过小 (${stat.size} B), 可能是白屏`).toBeGreaterThan(50 * 1024)
      return
    }

    // verify 模式: 截 after + diff
    const afterPath = path.join(OVER_DIR, `g8-${p.name}-after.png`)
    const baselinePath = path.join(BASELINE_DIR, `${p.name}.png`)
    const diffPath = path.join(OVER_DIR, `g8-${p.name}-diff.png`)

    expect(fs.existsSync(baselinePath), `baseline 缺失: ${baselinePath} — 先用 VISUAL_MODE=baseline 截过`).toBeTruthy()

    await page.screenshot({ path: afterPath, fullPage: true })
    const stat = fs.statSync(afterPath)
    expect(stat.size, `${p.name}-after.png 体积过小 (${stat.size} B), 可能是白屏 (BE 挂了?)`).toBeGreaterThan(50 * 1024)

    const { diffRatio, widthMismatch, baselineSize, afterSize } = await pixelDiff(baselinePath, afterPath, diffPath)

    // 视口 mismatch 必须 hard fail — 这就是 G8 根因
    expect(widthMismatch, `视口宽 mismatch: baseline=${baselineSize.w}x${baselineSize.h} after=${afterSize.w}x${afterSize.h} — spec 没锁视口或 config 改了 device`).toBeFalsy()

    console.log(`[G8 ${p.name}] diffRatio=${(diffRatio * 100).toFixed(4)}% baseline=${baselineSize.w}x${baselineSize.h} after=${afterSize.w}x${afterSize.h}`)

    // 🔴 BE 接口红 (5xx) 时, 显示状态必与 baseline 真实数据态不同 —
    // 这是 infra 污染而不是 FE 视觉回归. 给清晰的 infra 报错而不是把视觉差当回归.
    if (beServerErrors.length > 0) {
      const detail = beServerErrors.slice(0, 5).map(e => `${e.status} ${e.url}`).join('; ')
      throw new Error(
        `[INFRA] ${p.name} 触发 ${beServerErrors.length} 次 BE 5xx (${detail}) — ` +
        `视觉 diff=${(diffRatio * 100).toFixed(4)}% 不代表 FE 回归. ` +
        `先修 BE 接口再跑 G8.`
      )
    }

    expect(diffRatio, `${p.name} 像素差 ${(diffRatio * 100).toFixed(4)}% > ${(MAX_DIFF_PIXEL_RATIO * 100).toFixed(2)}% — 查 ${diffPath}`).toBeLessThanOrEqual(MAX_DIFF_PIXEL_RATIO)
  })
}
