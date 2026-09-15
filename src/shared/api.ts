import type {
  AddLinksResult,
  AppSnapshot,
  Batch,
  CreateBatchInput,
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
  getEnvironment(): Promise<EnvInfo>

  addLinks(text: string): Promise<AddLinksResult>
  removeLinks(ids: number[]): Promise<void>
  retryLinks(ids: number[]): Promise<void>

  resolverStart(): Promise<void>
  resolverStop(): Promise<void>
  resolverSkip(): Promise<void>

  pickFolder(defaultPath?: string): Promise<string | null>
  createBatch(input: CreateBatchInput): Promise<Batch>

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
  'getEnvironment',
  'addLinks',
  'removeLinks',
  'retryLinks',
  'resolverStart',
  'resolverStop',
  'resolverSkip',
  'pickFolder',
  'createBatch',
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
}

export const eventChannels = {
  onSnapshot: 'wp:snapshot',
  onSettings: 'wp:settings',
  onUpdate: 'wp:update',
  onToast: 'wp:toast'
} as const satisfies Record<keyof EventApi, string>

export type WaypointApi = InvokeApi & EventApi
