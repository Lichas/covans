// Real Electron, bundled assets and isolated profile; no model service calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { expect } from '@playwright/test'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Validate the actual distributable assets, including optional local source parity.
const bundledDir = path.join(root, 'resources/avatar-lifestyle')
const ratings = JSON.parse(fs.readFileSync(path.join(bundledDir, 'catalog.json'), 'utf8'))
const photoNames = (directory) => fs.readdirSync(directory).filter((name) => /\.(png|jpe?g|webp)$/i.test(name)).sort()
const bundledNames = photoNames(bundledDir)
assert.deepEqual(Object.keys(ratings).sort(), bundledNames, 'Every bundled photo must be explicitly classified')
for (const [name, rating] of Object.entries(ratings)) {
  assert.match(name, /^avatar-(0[1-9]|1[0-2])-[\w-]+\.(png|jpe?g|webp)$/i)
  assert.ok(['general', 'mature'].includes(rating), `Invalid rating: ${name}`)
}
const sourceDir = path.join(root, 'artifacts/avatar-lifestyle')
if (fs.existsSync(sourceDir)) {
  assert.deepEqual(bundledNames, photoNames(sourceDir), 'Source lifestyle photos must all be bundled')
  const digest = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  for (const name of bundledNames)
    assert.equal(digest(path.join(bundledDir, name)), digest(path.join(sourceDir, name)), `Bundled photo differs: ${name}`)
}
const generalNames = bundledNames.filter((name) => ratings[name] === 'general')
console.log(`✓ Lifestyle manifest and source parity: ${bundledNames.length} photos, ${generalNames.length} general`)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'covan-avatar-ui-'))
const artifacts = path.join(root, 'artifacts', 'avatar-ui')
fs.mkdirSync(artifacts, { recursive: true })
let app, page
const errors = []
const launch = async () => {
  app = await electron.launch({
    args: [root],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      COVAN_USER_DATA_DIR: profile,
    },
  })
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForFunction(() => !!window.covan)
}
try {
  await launch()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const catalog = await page.evaluate(() => window.covan.listPresetAvatars())
  assert.equal(catalog.length, 12)
  assert.equal(catalog.filter((p) => p.gender === 'female').length, 6)
  assert.deepEqual(catalog.flatMap((p) => p.lifestyle.map((photo) => path.basename(photo))).sort(), generalNames)
  for (const preset of catalog)
    for (const photo of preset.lifestyle) {
      assert.ok(path.basename(photo).startsWith(preset.id + '-'))
      assert.ok(fs.existsSync(path.join(profile, photo)))
    }
  await page.getByRole('button', { name: '创建你的 Bot' }).click()
  await expect(page.getByRole('button', { name: '♀ 女生' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page
      .getByRole('group', { name: '内置头像', exact: true })
      .getByRole('button'),
  ).toHaveCount(6)
  await page.screenshot({ path: path.join(artifacts, 'create-female.png') })
  await page.getByRole('button', { name: '♂ 男生' }).click()
  await expect(
    page.getByRole('button', { name: '选择晴空头像' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '选择青柠头像' }).click()
  await page.getByLabel('名称', { exact: true }).fill('形象伙伴')
  await page.getByRole('button', { name: '创建并开始聊天' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  let bot = (await page.evaluate(() => window.covan.listBots()))[0]
  assert.equal(bot.gender, 'male')
  assert.match(bot.avatar, /avatar-04-/)
  const botId = bot.id
  const getBot = async () =>
    (await page.evaluate(() => window.covan.listBots())).find(
      (b) => b.id === botId,
    )
  const rejection = await page.evaluate(async () => {
    try {
      await window.covan.createBot({ name: 'invalid', gender: 'invalid' })
      return ''
    } catch (e) {
      return String(e)
    }
  })
  assert.match(rejection, /未知 Bot 性别/)
  const defaults = await page.evaluate(async () => {
    const female = await window.covan.createBot({ name: '默认女生' })
    const male = await window.covan.createBot({
      name: '默认男生',
      gender: 'male',
    })
    return { female, male }
  })
  for (const [gender, item] of Object.entries(defaults))
    assert.equal(catalog.find((p) => p.avatar === item.avatar)?.gender, gender)
  await page.reload()
  await page.getByRole('button', { name: '展开设置' }).click()
  await expect(page.getByText('生成 / 更换头像 ↗')).toHaveCount(0)
  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '更换头像' })
  assert.deepEqual(
    await page
      .getByRole('group', { name: '头像来源' })
      .getByRole('button')
      .allTextContents(),
    ['内置头像', '自定义上传', 'AI 生图'],
  )
  await page.getByRole('button', { name: '♀ 女生' }).click()
  await page.getByRole('button', { name: '选择暖杏头像' }).click()
  assert.equal((await getBot()).avatar, bot.avatar, 'Preview must not save')
  await page.keyboard.press('Escape')
  assert.equal(
    (await getBot()).avatar,
    bot.avatar,
    'Cancel must preserve avatar',
  )
  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  await page.getByRole('button', { name: '♀ 女生' }).click()
  await page.getByRole('button', { name: '选择暖杏头像' }).click()
  await page.screenshot({ path: path.join(artifacts, 'avatar-picker.png') })
  await page.getByRole('button', { name: '应用头像', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('已应用内置头像')
  assert.equal((await getBot()).gender, 'female')
  await page.keyboard.press('Escape')
  const showcase = page.getByRole('region', { name: '形象伙伴的生活照' })
  await expect(showcase).toHaveCount(0)
  await page.getByRole('button', { name: '生活照', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '生活照', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '编辑人设', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '设定', exact: true }).click()
  await expect(showcase).toHaveCount(0)
  await expect(page.getByRole('button', { name: '编辑人设', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '生活照', exact: true }).click()
  await expect(showcase).toBeVisible()
  await expect(showcase.locator('img.is-active')).toHaveAttribute(
    'src',
    /avatar-01-/,
  )
  await expect
    .poll(() =>
      showcase.locator('img.is-active').evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0)
  await expect(
    showcase.getByRole('button', { name: '暂停生活照' }),
  ).toHaveCount(0)
  await showcase.getByRole('button', { name: '下一张生活照' }).click()
  await expect(
    showcase.getByRole('button', { name: '查看第 2 张生活照' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(
    showcase.getByRole('button', { name: '查看第 1 张生活照' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '生活照', exact: true }).focus()
  await page.mouse.move(20, 20)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await expect(
    showcase.getByRole('button', { name: '查看第 2 张生活照' }),
  ).toHaveAttribute('aria-pressed', 'true', { timeout: 7500 })
  await showcase.getByRole('button', { name: '暂停生活照' }).click()
  await expect(
    showcase.getByRole('button', { name: '播放生活照' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '生活照', exact: true }).focus()
  await page.mouse.move(20, 20)
  const pausedPhoto = await showcase
    .locator('img.is-active')
    .getAttribute('src')
  await expect(showcase.getByRole('button', { name: '播放生活照' })).toBeVisible()
  await page.waitForTimeout(5300)
  await expect(showcase.getByRole('button', { name: '播放生活照' })).toBeVisible()

  assert.equal(
    await showcase.locator('img.is-active').getAttribute('src'),
    pausedPhoto,
  )
  await page.screenshot({ path: path.join(artifacts, 'lifestyle.png') })
  console.log(
    '✓ Creation, catalog, persistence, preview/cancel/apply, reduced motion, manual and automatic slideshow',
  )

  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  await page.getByRole('button', { name: '自定义上传', exact: true }).click()
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
  })
  const beforeUpload = (await getBot()).avatar
  await page.getByRole('button', { name: '选择图片并应用' }).click()
  await expect(
    page.getByRole('button', { name: '选择图片并应用' }),
  ).toBeEnabled()
  assert.equal((await getBot()).avatar, beforeUpload)
  await app.evaluate(
    ({ dialog }, photo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [photo],
      })
    },
    path.join(root, 'resources/default-avatars/avatar-01-original.png'),
  )
  await page.getByRole('button', { name: '选择图片并应用' }).click()
  await expect(dialog.getByRole('status')).toContainText('已应用上传')
  await page.keyboard.press('Escape')
  await expect(showcase).toHaveCount(0)
  await expect(page.getByText('当前头像暂无可展示的生活照')).toBeVisible()
  const uploaded = (await getBot()).avatar
  await page.evaluate(async (id) => {
    await window.covan.updateBot(id, {
      name: '形象伙伴',
      description: '修改描述保留上传头像',
    })
  }, botId)
  assert.equal((await getBot()).avatar, uploaded)
  await page.evaluate(async (id) => {
    await window.covan.updateBot(id, {
      avatar: 'avatars/preset/avatar-05-original.png',
      gender: 'male',
    })
  }, botId)
  await expect(showcase.locator('img')).toHaveCount(2)
  await expect(showcase.locator('img.is-active')).toHaveAttribute('src', /avatar-05-coffee-roastery/)
  await page.evaluate(async (id) => {
    await window.covan.updateBot(id, {
      avatar: 'avatars/preset/avatar-08-original.png',
      gender: 'female',
    })
  }, botId)
  await expect(showcase).toBeVisible()
  await expect(
    showcase.getByRole('button', { name: '查看第 1 张生活照' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(960, 640),
  )
  await page.getByRole('button', { name: '更换头像', exact: true }).click()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page
    .getByRole('button', { name: '选择珊瑚头像' })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: path.join(artifacts, 'avatar-compact-dark.png'),
  })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
  await page.getByRole('button', { name: '当前头像' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '当前头像' })).toBeVisible()
  await page.keyboard.press('Escape')
  console.log(
    '✓ Native upload/cancel, custom-avatar preservation, missing-photo hide, identity reset, compact dark layout',
  )

  // A saved opt-in updates the gallery and template preview without rewriting Bot prompts.
  const maturePhoto =
    'avatars/preset/lifestyle/avatar-08/avatar-08-seaside-boardwalk.png'
  const photoReadable = () =>
    page.evaluate(
      (photo) =>
        new Promise((resolve) => {
          const image = new Image()
          image.onload = () => resolve(true)
          image.onerror = () => resolve(false)
          image.src = `covan-avatar://local/${photo}`
        }),
      maturePhoto,
    )
  assert.equal(
    await photoReadable(),
    false,
    'Direct mature photo reads are hidden by default',
  )
  await page.getByRole('button', { name: '关于我', exact: false }).click()
  const matureSwitch = page.getByRole('switch', { name: '接受成熟内容' })
  await expect(matureSwitch).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: path.join(artifacts, 'profile-preference-first-screen.png') })
  await expect(matureSwitch).toHaveAttribute('aria-checked', 'false')
  await page.getByLabel('怎么称呼我').fill('尚未保存的昵称')
  await matureSwitch.click()
  await expect(matureSwitch).toHaveAttribute('aria-checked', 'true')
  assert.equal(
    (await page.evaluate(() => window.covan.getUserProfile())).name,
    '',
    'Switch must not save unrelated drafts',
  )
  await expect(page.getByLabel('怎么称呼我')).toHaveValue('尚未保存的昵称')
  assert.equal(
    (await page.evaluate(() => window.covan.listPresetAvatars())).flatMap(
      (p) => p.lifestyle,
    ).length,
    bundledNames.length,
  )
  const allPhotos = (await page.evaluate(() => window.covan.listPresetAvatars())).flatMap((p) => p.lifestyle)
  assert.deepEqual(allPhotos.map((photo) => path.basename(photo)).sort(), bundledNames)
  const unreadable = await page.evaluate(async (photos) => {
    const results = await Promise.all(photos.map((photo) => new Promise((resolve) => {
      const img = new Image()
      img.onload = () => resolve(null)
      img.onerror = () => resolve(photo)
      img.src = `covan-avatar://local/${photo}`
    })))
    return results.filter(Boolean)
  }, allPhotos)
  assert.deepEqual(unreadable, [], 'All bundled photos, including new swimsuit images, must load with opt-in')
  assert.equal(await photoReadable(), true)
  await page.screenshot({ path: path.join(artifacts, 'mature-preference.png') })
  await page.keyboard.press('Escape')
  await expect(showcase.locator('img')).toHaveCount(5)
  await showcase.getByRole('button', { name: '查看第 2 张生活照' }).click()
  await expect(showcase.locator('img.is-active')).toHaveAttribute(
    'src',
    /seaside-boardwalk/,
  )
  await expect
    .poll(() =>
      showcase.locator('img.is-active').evaluate((img) => img.naturalWidth),
    )
    .toBeGreaterThan(0)
  await page.keyboard.press('Control+1')
  await expect(page.getByRole('dialog', { name: '新建 Bot' })).toBeVisible()
  await page.getByLabel('人设模板').selectOption('boyfriend')
  await expect(page.getByRole('button', { name: '♂ 男生' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('人设预览（可编辑）')).toHaveValue(/轻度调情/)
  await page.getByLabel('人设模板').selectOption('girlfriend')
  await expect(page.getByRole('button', { name: '♀ 女生' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('人设预览（可编辑）')).toHaveValue(
    /用户已开启成熟内容偏好/,
  )
  await page.keyboard.press('Escape')
  await page.reload()
  await page.getByRole('button', { name: '展开设置' }).click()
  await page.getByRole('button', { name: '生活照', exact: true }).click()
  await expect(showcase.locator('img')).toHaveCount(5)
  assert.equal(
    (await page.evaluate(() => window.covan.getUserProfile()))
      .accept_mature_content,
    true,
  )
  await page.getByRole('button', { name: '关于我', exact: false }).click()
  await expect(matureSwitch).toHaveAttribute('aria-checked', 'true')
  await matureSwitch.click()
  await expect(matureSwitch).toHaveAttribute('aria-checked', 'false')
  assert.equal(
    await photoReadable(),
    false,
    'Previously loaded mature photo cannot be read after opt-out',
  )
  await page.keyboard.press('Escape')
  await expect(showcase.locator('img')).toHaveCount(3)
  await expect(showcase.locator('img[src*="seaside-boardwalk"]')).toHaveCount(0)
  await page.keyboard.press('Control+1')
  await expect(page.getByRole('dialog', { name: '新建 Bot' })).toBeVisible()
  await page.getByLabel('人设模板').selectOption('boyfriend')
  await expect(page.getByLabel('人设预览（可编辑）')).toHaveValue(
    /用户未开启成熟内容偏好/,
  )
  await page.getByLabel('人设预览（可编辑）').fill('自定义伴侣设定')
  await page.evaluate(async () => {
    const profile = await window.covan.getUserProfile()
    await window.covan.saveUserProfile({
      ...profile,
      accept_mature_content: true,
    })
  })
  await expect(page.getByLabel('人设模板')).toBeEnabled()
  await expect(page.getByLabel('人设预览（可编辑）')).toHaveValue(
    '自定义伴侣设定',
  )
  await page.keyboard.press('Escape')
  console.log(
    '✓ Mature preference defaults, isolated save, opt-in/out gallery and protocol filtering, reload, companion previews and custom-prompt preservation',
  )

  await page.getByRole('button', { name: '关于我', exact: false }).click()
  await page.getByRole('button', { name: /对我的了解/ }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '关于我', exact: false }).click()
  await expect(matureSwitch).toBeInViewport({ ratio: 1 })
  await expect(matureSwitch).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')

  // Simulate the previous schema and verify startup migration retains avatar paths.
  await app.evaluate(({ app }) => {
    const req = process
      .getBuiltinModule('module')
      .createRequire(app.getAppPath() + '/package.json')
    const Database = req('better-sqlite3')
    const db = new Database(app.getPath('userData') + '/covan.db')
    db.exec('ALTER TABLE bots DROP COLUMN gender')
    db.close()
  })
  await app.close()
  await launch()
  assert.equal(
    (await page.evaluate(() => window.covan.getUserProfile()))
      .accept_mature_content,
    true,
    'Mature preference persists across process restart',
  )
  const migrated = await page.evaluate(() => window.covan.listBots())
  assert.equal(migrated.find((b) => b.id === defaults.male.id).gender, 'male')
  assert.equal(
    migrated.find((b) => b.id === defaults.female.id).gender,
    'female',
  )
  assert.equal(
    migrated.find((b) => b.id === botId).avatar,
    'avatars/preset/avatar-08-original.png',
  )
  assert.deepEqual(errors, [])
  console.log(
    '✓ Legacy database migration and restart persistence; no renderer errors',
  )
} finally {
  await app?.close().catch(() => {})
  fs.rmSync(profile, { recursive: true, force: true })
}
