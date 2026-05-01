// https://vitepress.dev/guide/custom-theme
import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'

import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 注册全局组件（如果需要）
    // app.component('MyGlobalComponent', MyGlobalComponent)
  }
} satisfies Theme