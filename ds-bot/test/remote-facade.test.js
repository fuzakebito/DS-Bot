import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachRemoteFacade } from '../remote-facade.js'

const own = { botId: 'fixture-bot', origin: { kind: 'own' } }
function fixture() {
  const messages = [], flushed = []
  const rooms = new Map([['fixture-room', { members: ['fixture-bot'], sessions: { 'fixture-bot': 'fixture-group' } }]])
  const rt = {
    botOf: id => id === 'fixture-bot', chatOf: () => 'fixture-current',
    roomOf: id => rooms.get(id), ensureCapabilities: async () => {},
    resolveAgent: async id => ({ session: { id }, followup: message => messages.push(message) }),
    ctx: { sessions: { flush: async session => flushed.push(session.id) } },
    isBotSession: id => ['fixture-current', 'fixture-group'].includes(id),
    selfOf: () => 'fixture-bot', groupOwners: new Map([['fixture-group', { roomId: 'fixture-room' }]]),
  }
  return { rt, rooms, messages, flushed, facade: attachRemoteFacade(rt, { createUserMessage: x => x }) }
}
test('facade source IDs distinguish kind and epoch; legacy fallback remains compatible', async () => {
  const f = fixture()
  for (const notificationId of ['child:1:3:message', 'child:1:3:completed', 'child:2:3:completed']) {
    await f.facade.deliver(own, { instance_id: 'fixture', agent_id: 'child', seq: 3, type: notificationId.endsWith('message') ? 'message' : 'completed', notificationId, text: 'Synthetic' })
  }
  assert.equal(new Set(f.messages.map(m => m.source.exchangeId)).size, 3)
  await f.facade.deliver(own, { instance_id: 'fixture', agent_id: 'child', seq: 4, type: 'completed' })
  assert.equal(f.messages.at(-1).source.exchangeId, 'remote:fixture:4:completed:child')
  assert.equal(f.flushed.length, 4)
})
test('facade resolves current own/group origins and refuses lost membership', async () => {
  const f = fixture()
  assert.deepEqual(f.facade.resolveOrigin({ id: 'fixture-current' }), own)
  const group = { botId: 'fixture-bot', origin: { kind: 'group', roomId: 'fixture-room' } }
  assert.deepEqual(f.facade.resolveOrigin({ id: 'fixture-group' }), group)
  await f.facade.deliver(group, { agent_id: 'child', seq: 1, type: 'message' })
  assert.equal(f.flushed[0], 'fixture-group')
  assert.equal(f.messages[0].source.roomId, 'fixture-room')
  f.rooms.clear()
  await assert.rejects(f.facade.deliver(group, {}), /membership/)
  assert.throws(() => f.facade.resolveOrigin({ id: 'not-a-bot' }), /current Bot/)
})
test('facade retries recipient part changes before enqueue', async () => {
  const f = fixture(); let current = 'fixture-old'
  f.rt.chatOf = () => current
  f.rt.ensureCapabilities = async () => { current = 'fixture-new' }
  await f.facade.deliver(own, { agent_id: 'child', seq: 1, type: 'completed' })
  assert.deepEqual(f.flushed, ['fixture-new'])
  assert.equal(f.messages.length, 1)
})
