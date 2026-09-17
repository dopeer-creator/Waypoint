import type {
  AddLinksResult,
  AppSnapshot,
  Batch,
  ClipboardAnswer,
  ClipboardOffer,
  CreateBatchInput,
  DiskSpace,
  EnvInfo,
  Settings,
  Toast,
  UpdateState
} from './types'

/** Request/response calls from renderer to main. Each maps to ipcMain.handle(`wp:${name}`). */
export interface InvokeApi {
  getSnapshot(): Promise<AppSnapshot>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  /** Throws away every preference and goes back to the out-of-the-box defaults. */
  resetSettings(): Promise<Settings>
  getEnvironment(): Promise<EnvInfo>

  addLinks(text: string): Promise<AddLinksResult>
  importLinks(): Promise<AddLinksResult | null>
  /** Import links from files the user dropped on the window; paths come from the preload's pathForFile. */
  importLinksFrom(paths: string[]): Promise<AddLinksResult | null>
  removeLinks(ids: number[]): Promise<void>
  retryLinks(ids: number[]): Promise<void>

  resolverStart(): Promise<void>
  resolverStop(): Promise<void>
  resolverSkip(): Promise<void>

  /** Closes a clipboard offer and remembers what not to offer again. */
  clipboardAnswer(answer: ClipboardAnswer): Promise<void>

  pickFolder(defaultPath?: string): Promise<string | null>
  diskSpace(path: string): Promise<DiskSpace | null>
  createBatch(input: CreateBatchInput): Promise<Batch>

  /** Moves a queued download earlier (delta -1) or later (delta +1) in the queue. */
  moveLink(id: number, delta: number): Promise<void>
  pauseLinks(ids: number[]): Promise<void>
  resumeLinks(ids: number[]): Promise<void>
  pauseBatch(id: number): Promise<void>
  resumeBatch(id: number): Promise<void>
  removeBatch(id: number): Promise<void>
  extractBatch(id: number): Promise<void>
  pauseAll(): Promise<void>
  resumeAll(): Promise<void>

  openPath(path: string): Promise<void>
  showInFolder(path: string): Promise<void>
  openLogs(): Promise<void>
  resetBrowserProfile(): Promise<void>
  openExtensionFolder(): Promise<void>
  copyText(text: string): Promise<void>
  setThemeBackground(themeId: string): Promise<boolean>
  clearThemeBackground(themeId: string): Promise<void>
  openThemesFolder(): Promise<void>
  setTitleBar(colors: { color: string; symbolColor: string }): Promise<void>

  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
}

export const invokeMethods = [
  'getSnapshot',
  'getSettings',
  'setSettings',
  'resetSettings',
  'getEnvironment',
  'addLinks',
  'importLinks',
  'importLinksFrom',
  'removeLinks',
  'retryLinks',
  'resolverStart',
  'resolverStop',
  'resolverSkip',
  'clipboardAnswer',
  'pickFolder',
  'diskSpace',
  'createBatch',
  'moveLink',
  'pauseLinks',
  'resumeLinks',
  'pauseBatch',
  'resumeBatch',
  'removeBatch',
  'extractBatch',
  'pauseAll',
  'resumeAll',
  'openPath',
  'showInFolder',
  'openLogs',
  'resetBrowserProfile',
  'openExtensionFolder',
  'copyText',
  'setThemeBackground',
  'clearThemeBackground',
  'openThemesFolder',
  'setTitleBar',
  'checkForUpdates',
  'installUpdate'
] as const satisfies readonly (keyof InvokeApi)[]

/** Push events from main to renderer. */
export interface EventApi {
  onSnapshot(cb: (snapshot: AppSnapshot) => void): () => void
  onSettings(cb: (settings: Settings) => void): () => void
  onUpdate(cb: (update: UpdateState) => void): () => void
  onToast(cb: (toast: Toast) => void): () => void
  onClipboardOffer(cb: (offer: ClipboardOffer) => void): () => void
}

export const eventChannels = {
  onSnapshot: 'wp:snapshot',
  onSettings: 'wp:settings',
  onUpdate: 'wp:update',
  onToast: 'wp:toast',
  onClipboardOffer: 'wp:clipboard-offer'
} as const satisfies Record<keyof EventApi, string>

/** Implemented directly in the preload, not over IPC. */
export interface BridgeApi {
  /** Absolute path of a file the user dropped. Electron removed File.path, so only the preload can resolve it. */
  pathForFile(file: File): string
}

export type WaypointApi = InvokeApi & EventApi & BridgeApi
