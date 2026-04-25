import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import './tokens.css'
import './styles.css'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'layout-bottom': () =>
        h('footer', { class: 'global-site-footer' }, [
          h(
            'a',
            {
              href: 'https://github.com/MJXWispX/ai-nav-knowledge',
              target: '_blank',
              rel: 'noreferrer'
            },
            'GitHub'
          ),
          h('p', null, '© 2026 WispX（螢塚）')
        ])
    })
}
