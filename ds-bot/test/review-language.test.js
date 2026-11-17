import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRuntime } from '../index.js'
import { reviewLanguage } from '../src/host/review-language.js'
import { writtenIn } from '../src/host/memory.js'
import { skillRequest, agentsRequest } from '../src/host/learning.js'

const legacy = (texts, fallback) => {
  const text = texts.join('\n')
  const han = (text.match(/\p{Script=Han}/gu) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (han + latin === 0) return fallback
  return han * 3 >= latin ? 'Chinese (简体中文)' : han === 0 ? 'English' : fallback
}

test('fixed language is bounded and auto keeps the legacy detector unchanged', () => {
  assert.equal(reviewLanguage(), undefined)
  assert.equal(reviewLanguage('auto'), undefined)
  for (const [option, label] of [['ja', 'Japanese (日本語)'], ['en', 'English'], ['zh', 'Chinese (简体中文)']]) {
    assert.equal(reviewLanguage(option), label)
    for (const texts of [[], ['👍'], ['東京'], ['日本語でお願いします'], ['Use pnpm'], ['帮我写个函数'], ['const value = 42']]) {
      for (const fallback of [undefined, 'English', 'Chinese (简体中文)', 'ja-JP']) {
        assert.equal(reviewLanguage(option) ?? writtenIn(texts, fallback), label)
        assert.equal(writtenIn(texts, fallback), legacy(texts, fallback))
      }
    }
  }
})

test('invalid language fails before reading runtime services or starting any module', () => {
  const ctx = new Proxy({}, { get() { assert.fail('runtime touched before language validation') } })
  for (const value of [null, false, 1, [], {}, 'JA', 'ja-JP', '', '__proto__', 'Japanese']) {
    assert.throws(() => createRuntime(ctx, { reviewLanguage: value }), { name: 'TypeError', message: 'reviewLanguage must be one of: auto, ja, en, zh' })
  }
})

test('fixed skill policy preserves technical material and does not alter AGENTS policy', () => {
  const content = 'Run `npm test` in /work/project.\n```js\nconst かな = "exact"\n```'
  const input = { bot: { name: 'Chief' }, lines: ['User: Check the release'], learned: [{ name: 'release-checks', description: 'Use for releases', content }] }
  const fixed = skillRequest({ ...input, language: reviewLanguage('ja'), fixedLanguage: reviewLanguage('ja') })
  assert.ok(fixed.includes(content))
  assert.match(fixed, /Write the description and the content in Japanese \(日本語\)/)
  assert.match(fixed, /Keep skill names, code, commands, paths, identifiers and exact quotations unchanged/)
  assert.match(fixed, /Never propose an update only to translate a skill/)
  const auto = skillRequest({ ...input, language: 'English' })
  assert.doesNotMatch(auto, /Never propose an update only to translate/)
  const agents = agentsRequest({ folder: '/fixture', current: '# Project\n- Existing rule', lines: [], language: 'English' })
  assert.doesNotMatch(agents, /Japanese/)
})
