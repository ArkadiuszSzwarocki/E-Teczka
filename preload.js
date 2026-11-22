const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ALLOWED_EVENTS = new Set([
  'eteczka-user-activity',
  'eteczka-confirm-close',
  'eteczka-wia-status',
  'eteczka-prepare-quit',
]);

const listenerMap = new WeakMap();

contextBridge.exposeInMainWorld('eteczkaElectron', {
  ipcRenderer: {
    invoke: (channel, ...args) => {
      if (typeof channel !== 'string' || !channel.startsWith('eteczka-')) {
        return Promise.reject(new Error('Niedozwolony kanał IPC.'));
      }
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, listener) => {
      if (!ALLOWED_EVENTS.has(channel) || typeof listener !== 'function') return;
      const wrapped = (_event, ...args) => listener(undefined, ...args);
      listenerMap.set(listener, wrapped);
      ipcRenderer.on(channel, wrapped);
    },
    removeListener: (channel, listener) => {
      if (!ALLOWED_EVENTS.has(channel) || typeof listener !== 'function') return;
      const wrapped = listenerMap.get(listener);
      if (wrapped) {
        ipcRenderer.removeListener(channel, wrapped);
        listenerMap.delete(listener);
      }
    },
  },
  getZoomFactor: () => webFrame.getZoomFactor(),
  setZoomFactor: (factor) => {
    if (typeof factor === 'number' && Number.isFinite(factor) && factor >= 0.5 && factor <= 2) {
      webFrame.setZoomFactor(factor);
    }
  },
  openExternal: (url) => ipcRenderer.invoke('eteczka-open-external', url),
});
