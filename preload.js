const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig:      ()      => ipcRenderer.invoke('get-config'),
  saveConfig:     (data)  => ipcRenderer.invoke('save-config', data),
  sendMessage:    (data)  => ipcRenderer.invoke('send-message', data),
  streamMessage:  (data)  => ipcRenderer.invoke('stream-message', data),
  stopStream:     (id)    => ipcRenderer.invoke('stop-stream', id),
  onStreamToken:  (cb)    => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('stream-token', handler);
    return () => ipcRenderer.removeListener('stream-token', handler);
  },
  takeScreenshot: ()      => ipcRenderer.invoke('take-screenshot'),
  exportChat:     (data)  => ipcRenderer.invoke('export-chat', data),
  hideWindow:     ()      => ipcRenderer.invoke('hide-window'),
  openExternal:   (url)   => ipcRenderer.invoke('open-external', url),
  setWindowScale: (scale) => ipcRenderer.invoke('set-window-scale', scale),
  setZoomFactor:  (f)     => webFrame.setZoomFactor(f),
  setHotkey:      (k)     => ipcRenderer.invoke('set-hotkey', k),
});
