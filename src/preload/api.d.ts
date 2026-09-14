import type { WaypointApi } from '../shared/api'

declare global {
  interface Window {
    waypoint: WaypointApi
  }
}

export {}
