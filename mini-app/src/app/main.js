import { createApp } from 'vue'
import App from './App.vue'

const shouldUseMocks =
  import.meta.env.DEV &&
  (import.meta.env.MODE === 'mock' || import.meta.env.VITE_USE_MOCKS === 'true')

const bootstrap = async () => {
  if (shouldUseMocks) {
    const { setupDevMocks } = await import('@/mocks/setupDevMocks.js')
    setupDevMocks()
  }

  createApp(App).mount('#app')
}

bootstrap().catch((error) => {
  console.error('Не удалось запустить miniapp', error)
})
