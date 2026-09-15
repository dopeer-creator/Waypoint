import type { ThemeId } from './types'

export interface ThemeInfo {
  id: ThemeId
  label: string
  /** 'core' themes sit under Appearance; 'destination' themes get their own section. */
  group: 'core' | 'destination'
  tagline?: string
  /** Settings card preview: background, sidebar, primary, muted line. */
  preview: [bg: string, side: string, primary: string, line: string]
}

export const THEMES: ThemeInfo[] = [
  { id: 'system', label: 'System', group: 'core', preview: ['#0b0f14', '#f3f5f9', '#3b82f6', '#94a3b8'] },
  { id: 'midnight', label: 'Midnight', group: 'core', preview: ['#0b0f14', '#0d121a', '#3b82f6', '#334155'] },
  { id: 'carbon', label: 'Carbon', group: 'core', preview: ['#070708', '#0a0a0c', '#e9eaee', '#2b2d32'] },
  { id: 'light', label: 'Light', group: 'core', preview: ['#f3f5f9', '#ffffff', '#2563eb', '#d3dae5'] },
  { id: 'ragnarok', label: 'Ragnarök', group: 'destination', tagline: 'Carved runestone and world serpent', preview: ['#0a1016', '#0c141b', '#d64541', '#7fb6d9'] },
  { id: 'jackdaw', label: 'Jackdaw', group: 'destination', tagline: 'Parchment sea chart and ship', preview: ['#0b1316', '#0d171a', '#c9973f', '#3aa19b'] },
  { id: 'nightcity', label: 'Night City', group: 'destination', tagline: 'Neon HUD on rain-slick black', preview: ['#07070c', '#0a0a12', '#fcee0a', '#ff2a6d'] },
  { id: 'tsushima', label: 'Tsushima', group: 'destination', tagline: 'Sumi-e ink that follows your cursor', preview: ['#0e0b0a', '#120e0c', '#e2a93b', '#c0392b'] },
  { id: 'wasteland', label: 'Wasteland', group: 'destination', tagline: 'Falling-code terminal', preview: ['#060906', '#080c08', '#3cf07a', '#4f7f58'] }
]

export const THEME_IDS: ThemeId[] = THEMES.map((t) => t.id)
