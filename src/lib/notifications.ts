import * as Notifications from 'expo-notifications'

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

export interface NotificationContent {
  title: string
  body: string
  data?: Record<string, any>
  sound?: string
}

export const NotificationService = {
  // Request permissions
  async requestPermissions(): Promise<boolean> {
    try {
      const { granted } = await Notifications.requestPermissionsAsync()
      return granted
    } catch (err) {
      console.error('❌ Notification permission error:', err)
      return false
    }
  },

  // Get push token
  async getPushToken(): Promise<string | null> {
    try {
      const token = (await Notifications.getExpoPushTokenAsync()).data
      console.log('✅ Push token obtained:', token)
      return token
    } catch (err) {
      console.error('❌ Error getting push token:', err)
      return null
    }
  },

  // Send local notification
  async sendLocalNotification(content: NotificationContent): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title,
          body: content.body,
          data: content.data || {},
          sound: content.sound || 'default',
        },
        trigger: null, // Immediate
      })
      console.log('✅ Notification sent:', content.title)
    } catch (err) {
      console.error('❌ Notification error:', err)
    }
  },

  // Schedule notification
  async scheduleNotification(
    content: NotificationContent,
    delayMs: number,
  ): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: content.title,
          body: content.body,
          data: content.data || {},
          sound: content.sound || 'default',
        },
        trigger: {
          seconds: Math.ceil(delayMs / 1000),
        },
      })
    } catch (err) {
      console.error('❌ Notification scheduling error:', err)
    }
  },

  // Listen to notifications
  onNotificationReceived(handler: (notification: Notifications.Notification) => void) {
    return Notifications.addNotificationReceivedListener(handler)
  },

  // Listen to notification responses
  onNotificationResponse(handler: (response: Notifications.NotificationResponse) => void) {
    return Notifications.addNotificationResponseReceivedListener(handler)
  },

  // Cancel notification
  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.dismissNotificationAsync(notificationId)
    } catch (err) {
      console.error('❌ Cancel notification error:', err)
    }
  },

  // Cancel all notifications
  async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.dismissAllNotificationsAsync()
    } catch (err) {
      console.error('❌ Cancel all notifications error:', err)
    }
  },
}
