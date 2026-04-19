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
   * @param {import('http').ServerResponse} res
   */
  addClient(res) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
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
}