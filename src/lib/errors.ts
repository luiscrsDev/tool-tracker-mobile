/**
 * User-friendly error messages for common scenarios
 */
export const ErrorMessages = {
  NETWORK_ERROR: 'Sem conexão. Verifique sua internet.',
  TIMEOUT: 'Operação expirou. Tente novamente.',
  PERMISSION_DENIED: 'Permissão negada. Verifique as configurações.',
  BLUETOOTH_DISABLED: 'Bluetooth desativado. Ative o Bluetooth.',
  LOCATION_DISABLED: 'Localização desativada. Ative a localização.',
  UNKNOWN_ERROR: 'Erro desconhecido. Tente novamente.',
  SUPABASE_ERROR: 'Erro ao conectar com servidor. Tente novamente.',
  VALIDATION_ERROR: 'Dados inválidos. Verifique os campos.',
  DUPLICATE_ENTRY: 'Este item já existe.',
  NOT_FOUND: 'Item não encontrado.',
}

/**
 * Map error to user-friendly message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()

    if (message.includes('network') || message.includes('offline')) {
      return ErrorMessages.NETWORK_ERROR
    }

    if (message.includes('timeout')) {
      return ErrorMessages.TIMEOUT
    }

    if (message.includes('permission')) {
      return ErrorMessages.PERMISSION_DENIED
    }

    if (message.includes('bluetooth')) {
      return ErrorMessages.BLUETOOTH_DISABLED
    }

    if (message.includes('location')) {
      return ErrorMessages.LOCATION_DISABLED
    }

    if (message.includes('duplicate')) {
      return ErrorMessages.DUPLICATE_ENTRY
    }

    if (message.includes('not found')) {
      return ErrorMessages.NOT_FOUND
    }

    if (message.includes('supabase') || message.includes('postgres')) {
      return ErrorMessages.SUPABASE_ERROR
    }

    return error.message
  }

  return ErrorMessages.UNKNOWN_ERROR
}

/**
 * Retry logic with exponential backoff
 * @param fn Function to retry
 * @param maxAttempts Max retry attempts (default: 3)
 * @param baseDelay Delay in ms (default: 1000)
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelay = 1000
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on last attempt
      if (attempt < maxAttempts - 1) {
        const delay = baseDelay * Math.pow(2, attempt)
        console.log(`⏳ Retry attempt ${attempt + 1}/${maxAttempts - 1} in ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Max retries exceeded')
}

/**
 * Timeout wrapper for promises
 * @param promise Promise to wrap
 * @param ms Timeout in ms
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), ms)
    ),
  ])
}
