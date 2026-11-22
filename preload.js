const { contextBridge, ipcRenderer, webFrame } = require('electron');

const ALLOWED_EVENTS = new Set([
  'mojateczka-user-activity',
  'mojateczka-confirm-close',
  'mojateczka-wia-status',
  'mojateczka-prepare-quit',
]);

const listenerMapByChannel = new Map();

contextBridge.exposeInMainWorld('mojateczkaElectron', {
  ipcRenderer: {
    invoke: (channel, ...args) => {
      if (typeof channel !== 'string' || !channel.startsWith('mojateczka-')) {
        return Promise.reject(new Error('Niedozwolony kanał IPC.'));
      }
      return ipcRenderer.invoke(channel, ...args);
    },
    on: (channel, listener) => {
      if (!ALLOWED_EVENTS.has(channel) || typeof listener !== 'function') return;
      let channelMap = listenerMapByChannel.get(channel);
      if (!channelMap) {
        channelMap = new WeakMap();
        listenerMapByChannel.set(channel, channelMap);
      }
      const wrapped = (_event, ...args) => listener(undefined, ...args);
      channelMap.set(listener, wrapped);
      ipcRenderer.on(channel, wrapped);
    },
    removeListener: (channel, listener) => {
      if (!ALLOWED_EVENTS.has(channel) || typeof listener !== 'function') return;
      const channelMap = listenerMapByChannel.get(channel);
      const wrapped = channelMap?.get(listener);
      if (wrapped) {
        ipcRenderer.removeListener(channel, wrapped);
        channelMap.delete(listener);
      }
    },
  },
  getZoomFactor: () => webFrame.getZoomFactor(),
  setZoomFactor: (factor) => {
    if (typeof factor === 'number' && Number.isFinite(factor) && factor >= 0.5 && factor <= 2) {
      webFrame.setZoomFactor(factor);
    }
  },
  openExternal: (url) => ipcRenderer.invoke('mojateczka-open-external', url),
});
