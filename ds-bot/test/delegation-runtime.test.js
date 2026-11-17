import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { install, output } from '../src/host/tools.js'

// No model requests, user profile, server or child agents: real Cordis scopes,
// tool restrictions, prompt assembly and execution guards are the test subject.
test('real DSH scopes lift delegation restrictions without weakening other Bot policies', async (t) => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const plugin of [LlmRuntime, SessionStore, SessionProjections, SystemPrompt, ToolRuntime, AgentRegistry]) await ctx.plugin(plugin)
  const executor = await import('@deepseek-ai/dsh-tool-executor-native').catch(error => {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return undefined
    throw error
  })
  if (executor !== undefined) await ctx.plugin(executor)
  const requests = []
  class MockAdapter extends LlmAdapter {
    async resolveModel(provider, model) { return { provider, id: model, name: model } }
    async *stream(request) { requests.push(request); yield { type: 'finish', reason: { kind: 'stop' } } }
  }
  ctx.llm.registerAdapter(['delegation-test'], new MockAdapter())
  await ctx.plugin(AgentLoop, { agents: [] })
  const ids = new Map([['writer', 'writer'], ['chief', 'chief'], ['room-writer', 'writer']])
  const config = { allowDelegation: false }
  const rt = {
    ctx, config, state: {}, teamTools: [],
    load: async () => {},
    selfOf: id => ids.get(id),
    isBotSession: id => ids.has(id),
    botOf: id => ids.has(id) ? { id } : undefined,
    roomOf: () => undefined,
    groupOwners: new Map(),
    warn: () => {},
  }
  // An inherited tool tests restrict disposal; a scoped tool tests the assembly
  // filter where restrict cannot hide the Agent's own registration.
  ctx.tools.register({ name: 'workflow', description: 'test workflow', parameters: {}, output, execute: async () => 'unused' })
  ctx.tools.register({ name: 'ask_user_question', description: 'test question', parameters: {}, output, execute: async () => 'unused' })
  const guards = []
  const registerGuard = ctx.tools.guard.bind(ctx.tools)
  ctx.tools.guard = check => { guards.push(check); return registerGuard(check) }
  install(rt)
  const writer = await ctx.agentLoop.create(SessionId('writer'), { provider: 'delegation-test', model: 'mock' })
  const chief = await ctx.agentLoop.create(SessionId('chief'))
  writer.ctx.tools.register({ name: 'subagent', description: 'test scoped delegation', parameters: {}, output, execute: async () => 'unused' })
  const visible = agent => ctx.tools.schemas(agent).map(tool => tool.name)
  const assemble = () => ctx.systemPrompt.assemble({ agent: writer, scope: writer })
  const guard = (agent, name) => guards.map(check => check({ agent, name, arguments: {} })).find(reason => reason !== undefined)
  assert.equal(visible(writer).includes('workflow'), false)
  assert.match(guard(writer, 'subagent'), /Bots do not start/)
  const before = await assemble()
  // 0.2.2 collects own-scope tools after the waterfall; its guard, not schema
  // removal, enforces denial. 0.2.1 also removes the schema itself.
  if (typeof ctx.tools.selectExecutor !== 'function') assert.equal(before.tools.some(tool => tool.name === 'subagent'), false)
  const requestTools = async () => {
    const idle = new Promise(resolve => {
      const dispose = ctx.on('agent/status', ({ agent, status }) => { if (agent === writer && status === 'idle') { dispose(); resolve() } })
    })
    writer.followup(createUserMessage({ content: [{ type: 'text', text: 'Check schema only' }], source: { kind: 'user' } }))
    await idle
    return requests.at(-1)?.tools?.map(tool => tool.name) ?? []
  }
  assert.equal((await requestTools()).includes('workflow'), false)
  config.allowDelegation = ['writer']
  rt.hideBotUnusedTools(writer)
  assert.equal((await requestTools()).includes('workflow'), true)
  assert.equal(visible(writer).includes('workflow'), true)
  assert.equal(visible(writer).includes('ask_user_question'), false)
  assert.equal(visible(chief).includes('workflow'), false)
  assert.equal(guard(writer, 'subagent'), undefined)
  assert.match(guard(chief, 'subagent'), /Bots do not start/)
  const allowed = await assemble()
  if (Array.isArray(allowed.tools)) assert.equal(allowed.tools.some(tool => tool.name === 'subagent'), true)
  config.allowDelegation = false
  rt.hideBotUnusedTools(writer)
  assert.equal((await requestTools()).includes('workflow'), false)
  assert.equal(visible(writer).includes('workflow'), false)
  assert.match(guard(writer, 'subagent'), /Bots do not start/)
})
