'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFiles:   ()      => ipcRenderer.invoke('pick-files'),
  pickFolder:  ()      => ipcRenderer.invoke('pick-folder'),
  inspect:     (paths) => ipcRenderer.invoke('inspect', paths),
  run:         (job)   => ipcRenderer.invoke('run', job),
  getSettings: ()      => ipcRenderer.invoke('get-settings'),
  setSettings: (s)     => ipcRenderer.invoke('set-settings', s),
  reveal:      (p)     => ipcRenderer.invoke('reveal', p),
  onOpenFiles: (cb)    => ipcRenderer.on('open-files', (_e, paths) => cb(paths)),
  onProgress:  (cb)    => ipcRenderer.on('progress', (_e, d) => cb(d)),
  // Electron 32 dropped File.path; webUtils is the supported way to resolve a drop.
  pathFor:     (file)  => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
