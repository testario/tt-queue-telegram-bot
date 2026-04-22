import { ref } from 'vue'
import { useApi } from './useApi.js'

const isAdmin = ref(null)  // null = ещё не проверяли, true/false = результат

export function useAdmin() {
  const api = useApi()

  const checkAdmin = async () => {
    if (isAdmin.value !== null) return  // уже проверяли

    try {
      const result = await api.get('/admin/check')
      isAdmin.value = result.isAdmin
    } catch {
      isAdmin.value = false
    }
  }

  const pause = () => api.post('/admin/pause')
  const resume = () => api.post('/admin/continue')
  const emerge = () => api.post('/admin/emerge')

  return { isAdmin, checkAdmin, pause, resume, emerge }
}
