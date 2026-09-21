import { SseManager } from '#interfaces/webapp/sse.js'

const fakeResponse = () => {
  const listeners = {}
  return {
    written: [],
    setHeader: () => {},
    write(chunk) {
      this.written.push(chunk)
    },
    on(event, handler) {
      listeners[event] = handler
    },
    emitClose() {
      listeners.close?.()
    },
  }
}

describe('SseManager', () => {
  test('notifyUser sends the event only to connections registered with a matching userId', () => {
    const manager = new SseManager()
    const aliceRes = fakeResponse()
    const bobRes = fakeResponse()
    const anonymousRes = fakeResponse()
    manager.addClient(aliceRes, 42)
    manager.addClient(bobRes, 7)
    manager.addClient(anonymousRes)

    manager.notifyUser(42, 'player_banned', { reason: 'player_banned' })

    expect(aliceRes.written).toEqual([
      'event: player_banned\ndata: {"reason":"player_banned"}\n\n',
    ])
    expect(bobRes.written).toEqual([])
    expect(anonymousRes.written).toEqual([])
  })

  test('notifyUser matches userId across string/number representations', () => {
    const manager = new SseManager()
    const res = fakeResponse()
    manager.addClient(res, 42)

    manager.notifyUser('42', 'player_banned', { reason: 'player_banned' })

    expect(res.written).toHaveLength(1)
  })

  test('notifyUser is a no-op when userId is null/undefined', () => {
    const manager = new SseManager()
    const res = fakeResponse()
    manager.addClient(res, null)

    manager.notifyUser(null, 'player_banned', {})
    manager.notifyUser(undefined, 'player_banned', {})

    expect(res.written).toEqual([])
  })

  test('drops a client from future notifyUser sends once its connection closes', () => {
    const manager = new SseManager()
    const res = fakeResponse()
    manager.addClient(res, 42)
    res.emitClose()

    manager.notifyUser(42, 'player_banned', {})

    expect(res.written).toEqual([])
  })

  test('notifyUser drops a client whose write throws (e.g. a socket that closed without firing close yet)', () => {
    const manager = new SseManager()
    const deadRes = fakeResponse()
    deadRes.write = () => { throw new Error('socket hang up') }
    const aliceRes = fakeResponse()
    manager.addClient(deadRes, 42)
    manager.addClient(aliceRes, 42)

    expect(() => manager.notifyUser(42, 'player_banned', {})).not.toThrow()
    expect(aliceRes.written).toHaveLength(1)

    // The throwing client must have been removed — a second notifyUser
    // shouldn't try (and fail) to write to it again.
    aliceRes.written.length = 0
    expect(() => manager.notifyUser(42, 'player_banned', {})).not.toThrow()
    expect(aliceRes.written).toHaveLength(1)
  })

  test('broadcast still reaches every client regardless of userId', () => {
    const manager = new SseManager()
    const aliceRes = fakeResponse()
    const anonymousRes = fakeResponse()
    manager.addClient(aliceRes, 42)
    manager.addClient(anonymousRes)

    manager.broadcast('state_update', { ok: true })

    expect(aliceRes.written).toHaveLength(1)
    expect(anonymousRes.written).toHaveLength(1)
  })
})
