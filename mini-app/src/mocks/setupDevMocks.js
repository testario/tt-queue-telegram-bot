const MATCH_MS = 1 * 60 * 1000  // 1 минута — реальная длительность матча
const READY_MS = 10 * 1000       // 10 секунд — время на подготовку

export const DEV_PLAYERS = [
  { username: '@dev_user', firstName: 'Dev',   lastName: 'User' },
  { username: '@anna',     firstName: 'Anna',  lastName: '' },
  { username: '@boris',    firstName: 'Boris', lastName: '' },
  { username: '@dima',     firstName: 'Dima',  lastName: '' },
  { username: '@ira',      firstName: 'Ira',   lastName: '' },
  { username: '@kate',     firstName: 'Kate',  lastName: '' },
  { username: '@maria',    firstName: 'Maria', lastName: '' },
  { username: '@nick',     firstName: 'Nick',  lastName: '' },
  { username: '@oleg',     firstName: 'Oleg',  lastName: '' },
  { username: '@sveta',    firstName: 'Sveta', lastName: '' },
  { username: '@lena',     firstName: 'Lena',  lastName: '' },
  { username: '@pavel',    firstName: 'Pavel', lastName: '' },
  { username: '@roman',    firstName: 'Roman', lastName: '' },
  { username: '@sonya',    firstName: 'Sonya', lastName: '' },
  { username: '@vlad',     firstName: 'Vlad',  lastName: '' },
  { username: '@yulia',    firstName: 'Yulia', lastName: '' },
]

export const createInitialDevState = () => {
  const now = Date.now()

  return {
    queue: [
      {
        player1: '@anna',
        player2: '@boris',
        status: 'playing',
        startDate: new Date(now - MATCH_MS / 2).toISOString(),
        endDate:   new Date(now + MATCH_MS / 2).toISOString(),
      },
      {
        player1: '@dima',
        player2: '@ira',
        status: 'waiting',
        startDate: new Date(now + MATCH_MS / 2 + READY_MS).toISOString(),
        endDate:   new Date(now + MATCH_MS / 2 + READY_MS + MATCH_MS).toISOString(),
      },
    ],
    searching: ['@kate', '@maria', '@nick'],
    played: ['@oleg', '@sveta'],
    pendingInvites: [
      { player: '@kate', opponent: '@dev_user', createdAt: now - 60 * 1000 },
    ],
  }
}

const setupTelegramMock = () => {
  window.Telegram = {
    ...(window.Telegram || {}),
    WebApp: {
      // Пустой initData — бэкенд в dev-режиме подставит @dev_user автоматически
      initData: '',
      initDataUnsafe: {
        user: {
          id: 10001,
          first_name: 'Dev',
          last_name: 'User',
          username: 'dev_user',
          language_code: 'ru',
        },
      },
      colorScheme: 'light',
      themeParams: {},
      ready: () => {},
      expand: () => {},
      close: () => {},
      showPopup: (options, callback) => {
        const confirmed = window.confirm(options.message)
        callback?.(confirmed ? 'ok' : 'cancel')
      },
    },
  }
}

const seedBackend = async () => {
  await fetch('/api/dev/seed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      players: DEV_PLAYERS,
      state: createInitialDevState(),
    }),
  })
}

export async function setupDevMocks() {
  setupTelegramMock()
  await seedBackend()
}
