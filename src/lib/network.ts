import NetInfo from '@react-native-community/netinfo'

export interface NetworkState {
  isConnected: boolean
  isInternetReachable: boolean
  type: string
}

/**
 * Network detection and monitoring service
 * Provides real-time network status for offline support
 */
export const NetworkService = {
  /**
   * Check current network status
   */
  async getStatus(): Promise<NetworkState> {
    const state = await NetInfo.fetch()
    return {
      isConnected: state.isConnected ?? false,
      isInternetReachable: state.isInternetReachable ?? false,
      type: state.type || 'unknown',
    }
  },

  /**
   * Subscribe to network changes
   * @param callback Fired when network state changes
   * @returns Unsubscribe function
   */
  subscribe(callback: (state: NetworkState) => void): () => void {
    const unsubscribe = NetInfo.addEventListener(state => {
      callback({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable ?? false,
        type: state.type || 'unknown',
      })
    })

    return () => {
      unsubscribe()
    }
  },

  /**
   * Check if device is online
   */
  async isOnline(): Promise<boolean> {
    const state = await NetworkService.getStatus()
    return state.isConnected && state.isInternetReachable !== false
  },

  /**
   * Wait for network to come online
   * @param timeout Max wait time in ms (default: 10s)
   */
  async waitForNetwork(timeout = 10000): Promise<boolean> {
    const startTime = Date.now()

    const checkNetwork = async (): Promise<boolean> => {
      const online = await NetworkService.isOnline()
      if (online) return true

      if (Date.now() - startTime > timeout) return false

      // Check again after 500ms
      await new Promise(resolve => setTimeout(resolve, 500))
      return checkNetwork()
    }

    return checkNetwork()
  },
}
