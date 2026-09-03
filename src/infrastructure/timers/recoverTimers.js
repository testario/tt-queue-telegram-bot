/**
 * Читает текущее состояние из репозитория и переплановывает таймеры
 * для матча, который должен был идти в момент рестарта.
 *
 * @param {{ repository, orchestrator, clock, logger }} deps
 */
export const recoverTimers = async ({ repository, orchestrator, clock, logger }) => {
  const log = logger || { info: () => {}, warn: () => {} }
  const state = await repository.get()

  if (!state.queue.length) {
    log.info('Восстановление таймеров: очередь пуста, восстанавливать нечего')
    return
  }

  const now = clock.now()
  const current = state.queue[0]

  if (current.endDate <= now) {
    // Матч уже должен был завершиться — завершаем сразу
    log.warn('Восстановление: матч просрочен, финишируем', {
      player1: current.player1,
      player2: current.player2,
      endDate: current.endDate,
    })
    await orchestrator.handleMatchFinished(current)
    return
  }

  if (current.status === 'playing') {
    log.info('Восстановление: матч в процессе, планируем только финиш', {
      player1: current.player1,
      player2: current.player2,
    })
    orchestrator.scheduleFinish(current)
  } else {
    log.info('Восстановление: матч ожидает старта, планируем полный lifecycle', {
      player1: current.player1,
      player2: current.player2,
    })
    orchestrator.scheduleLifecycle(current)
  }
}
