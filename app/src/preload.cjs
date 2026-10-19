// Gives the DSH Web entry the boot handshake it uses inside an app window, and marks the
// document root the way DSH Desktop's preload does (apps/desktop/src/preload-platform.ts,
// preload-windows.ts and preload-theme.ts; see NOTICE) so the window can go frameless.
const { contextBridge, ipcRenderer } = require('electron')

if (location.protocol === 'dsh-app:' && location.hostname === 'app') {
  contextBridge.exposeInMainWorld('dshDesktopBoot', {
    ready: () => ipcRenderer.invoke('ds-bot:boot'),
    failed: (message) => ipcRenderer.invoke('ds-bot:boot-failed', String(message)),
  })
  // Marked as desktop (data-platform below), the Web frontend asks for the desktop bridge;
  // this window has no native menus, so native shortcut input never comes and the bridge
  // only needs to exist.
  contextBridge.exposeInMainWorld('dshDesktop', {
    keyboard: { subscribe: (_listener) => () => {} },
  })

  // The look is a prototype switch; the injected stylesheet scopes on the attribute.
  const look = process.env.DS_BOT_LOOK ?? 'plain'
  const mark = () => {
    document.documentElement.dataset.platform = process.platform
    document.documentElement.dataset.dsBotLook = look
    // The Windows caption band takes 40px at the top of the page (windows-layout.ts).
    if (process.platform === 'win32') {
      document.documentElement.dataset.windowsTitlebar = ''
      document.documentElement.style.setProperty('--dsh-windows-titlebar-height', '40px')
    }
  }
  if (document.documentElement === null) window.addEventListener('DOMContentLoaded', mark, { once: true })
  else mark()

  // The main process sends this on every fullscreen change and after each load; the CSS
  // drops the caption clearance while the native controls are away.
  ipcRenderer.on('ds-bot:window-fullscreen', (_event, fullscreen) => {
    if (document.documentElement === null) return
    if (fullscreen) document.documentElement.dataset.fullscreen = 'true'
    else delete document.documentElement.dataset.fullscreen
  })

  if (process.platform === 'win32') {
    // The caption buttons' overlay follows the sidebar palette; the probe renders the CSS
    // variables into a pixel so a canvas can read the resolved color (the color half of
    // DSH's preload-windows.ts, without its menu).
    const install = () => {
      const probe = document.createElement('span')
      // The glass looks give the caption its own variable so the buttons can sit on the
      // material instead of the opaque sidebar fill.
      probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;background-color:var(--ds-bot-caption-fill, var(--dsw-specific-sidebar-fill));color:var(--dsw-alias-label-primary)'
      document.body.append(probe)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 1
      const canvasContext = canvas.getContext('2d', { willReadFrequently: true })
      if (canvasContext === null) return
      const pixel = (color) => {
        canvasContext.clearRect(0, 0, 1, 1)
        canvasContext.fillStyle = color
        canvasContext.fillRect(0, 0, 1, 1)
        const [red, green, blue, alpha] = canvasContext.getImageData(0, 0, 1, 1).data
        return `rgba(${red}, ${green}, ${blue}, ${Number(alpha) / 255})`
      }
      let previous = ''
      const send = () => {
        const style = getComputedStyle(probe)
        const values = [pixel(style.backgroundColor), pixel(style.color)]
        const current = JSON.stringify(values)
        if (current === previous) return
        previous = current
        ipcRenderer.send('ds-bot:windows-appearance', document.documentElement.lang, ...values)
      }
      const observer = new MutationObserver(send)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'style'] })
      observer.observe(document.head, { childList: true, subtree: true, characterData: true })
      document.head.addEventListener('load', send, true)
      window.addEventListener('pagehide', () => {
        observer.disconnect()
        probe.remove()
        document.head.removeEventListener('load', send, true)
      }, { once: true })
      send()
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true })
    else install()
  }

  // The Web UI's theme bootstrap writes data-ds-theme-source on <html>; the window's
  // native chrome and the macOS vibrancy material follow it.
  let sent
  const sendTheme = () => {
    const value = document.documentElement.getAttribute('data-ds-theme-source')
    if (value === null || value === sent) return
    sent = value
    ipcRenderer.send('ds-bot:native-theme-set', value)
  }
  const observeTheme = () => {
    new MutationObserver(sendTheme).observe(document.documentElement, { attributeFilter: ['data-ds-theme-source'] })
    sendTheme()
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', observeTheme, { once: true })
  else observeTheme()
}
