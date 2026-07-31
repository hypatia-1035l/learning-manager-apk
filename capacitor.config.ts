import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.learning.manager',
  appName: '今天摸啥鱼',
  webDir: 'dist',
  // Android 使用 https scheme，便于 localStorage / module 加载
  server: {
    androidScheme: 'https',
  },
  android: {
    // 允许混合内容（如本地资源）
    allowMixedContent: true,
  },
}

export default config
