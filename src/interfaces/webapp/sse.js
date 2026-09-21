/**
 * Менеджер Server-Sent Events соединений.
 * Хранит множество активных клиентов и транслирует им события.
 */
export class SseManager {
  constructor() {
    this.clients = new Set()
  }

  /**
   * Добавляет клиента: устанавливает SSE-заголовки и подписывается на close.
   * userId привязывается к соединению (если известен), чтобы иметь
   * возможность адресно оповестить конкретного игрока (см. notifyUser) —
   * например, мгновенно сообщить о бане, не дожидаясь его следующего запроса.
   * @param {import('http').ServerResponse} res
   * @param {string|number|null} [userId]
   */
  addClient(res, userId = null) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.__sseUserId = userId != null ? String(userId) : null
    this.clients.add(res)
    res.on('close', () => this.clients.delete(res))
  }

  /**
   * Рассылает событие всем подключённым клиентам.
   * @param {string} event
   * @param {unknown} data
   */
  broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    this.clients.forEach((res) => {
      try {
        res.write(message)
      } catch {
        this.clients.delete(res)
      }
    })
  }

  /**
   * Отправляет событие только соединениям конкретного игрока (см. userId в
   * addClient). Используется для мгновенного оповещения о бане — если у
   * игрока в этот момент открыт мини-апп, он узнаёт об этом сразу, не
   * дожидаясь следующего запроса к API.
   * @param {string|number|null|undefined} userId
   * @param {string} event
   * @param {unknown} data
   */
  notifyUser(userId, event, data) {
    if (userId == null) return
    const key = String(userId)
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    this.clients.forEach((res) => {
      if (res.__sseUserId !== key) return
      try {
        res.write(message)
      } catch {
        this.clients.delete(res)
      }
    })
  }

  /**
   * Подписывается на Redis Pub/Sub канал для получения событий из bot-процесса.
   * Используется когда бот и бэкенд — разные процессы.
   * @param {import('#infrastructure/events/RedisEventBus.js').RedisEventBus} eventBus
   * @param {() => Promise<object>} buildPayload
   */
  async subscribeToRedis(eventBus, buildPayload) {
    await eventBus.subscribe(async () => {
      try {
        const payload = await buildPayload()
        this.broadcast('state_update', payload)
      } catch (err) {
        console.error('SseManager: ошибка при обработке Redis-события', err.message)
      }
    })
  }
}