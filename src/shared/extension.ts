/** ID of the bundled Waypoint browser extension, fixed by the public key in its manifest. */
export const EXTENSION_ID = 'hmcegkdljkbmbmnlpcjhiapnmopeliol'

/** Localhost ports the extension offers downloads to, in order. Installed Waypoint listens on the first, dev runs on the second. */
export const CAPTURE_PORTS = [47815, 47816] as const
