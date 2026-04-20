import { ref } from 'vue'
import { useApi } from './useApi.js'

export function useAdmin() {
  const { get, post } = useApi()
  const isAdmin = ref(false)
  const checking = ref(false)
  const loading = ref(false)
  const error = ref(null)

  const checkAdmin = async () => {
    checking.value = true
    try {
      const data = await get('/admin/check')
      isAdmin.value = data.isAdmin ?? false
    } catch {
      isAdmin.value = false
    } finally {
      checking.value = false
    }
  }

  const pause = async () => {
    loading.value = true
    error.value = null
    try {
      return await post('/admin/pause')
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  const resume = async () => {
    loading.value = true
    error.value = null
    try {
      return await post('/admin/continue')
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  const emerge = async () => {
    loading.value = true
    error.value = null
    try {
      return await post('/admin/emerge')
    } catch (e) {
      error.value = e.message
    } finally {
      loading.value = false
    }
  }

  return { isAdmin, checking, loading, error, checkAdmin, pause, resume, emerge }
}
