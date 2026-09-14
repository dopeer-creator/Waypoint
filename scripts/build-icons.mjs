// Renders the Waypoint brand SVGs into the icon/PNG assets the app and installer need.
// Run with `npm run icons` after editing anything in design/brand.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = join(root, 'design', 'brand')

const markSvg = await readFile(join(brand, 'mark.svg'), 'utf8')
const wordmarkSvg = await readFile(join(brand, 'wordmark.svg'), 'utf8')

// Inner content of an SVG file, without the outer <svg> element.
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// Full mark on a dark rounded tile — used for 48px and up.
function tile(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1A2230"/><stop offset="1" stop-color="#05070B"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="960" height="960" rx="216" fill="url(#bg)"/>
  <rect x="34" y="34" width="956" height="956" rx="214" fill="none" stroke="#FFFFFF" stroke-opacity="0.08" stroke-width="4"/>
  <svg x="152" y="136" width="720" height="720" viewBox="588 211 360 360">${inner(markSvg)}</svg>
</svg>`
}

// Simplified mark for tiny sizes: thin arcs and the star vanish below 48px, so drop them and enlarge the arrow.
function tinyTile(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect x="0" y="0" width="1024" height="1024" rx="200" fill="#0B0F16"/>
  <svg x="112" y="96" width="800" height="800" viewBox="598 222 340 340">
    <path d="M768 222L603 552L768 395Z" fill="#FFFFFF"/>
    <path d="M768 222L933 552L768 395Z" fill="#B9BDC5"/>
  </svg>
</svg>`
}

const png = (svg) => sharp(Buffer.from(svg)).png().toBuffer()

await mkdir(join(root, 'build'), { recursive: true })
await mkdir(join(root, 'resources', 'icons'), { recursive: true })
await mkdir(join(root, 'docs'), { recursive: true })

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
const icoPngs = await Promise.all(icoSizes.map((s) => png(s < 48 ? tinyTile(s) : tile(s))))
await writeFile(join(root, 'build', 'icon.ico'), await pngToIco(icoPngs))
await writeFile(join(root, 'build', 'icon.png'), await png(tile(1024)))

// Runtime assets: window/tray icon and notification image.
await writeFile(join(root, 'resources', 'icons', 'icon.png'), await png(tile(256)))
await writeFile(join(root, 'resources', 'icons', 'icon.ico'), await pngToIco(icoPngs))

// Standalone transparent mark, plus a README banner matching the original logo.
await writeFile(join(brand, 'mark-1024.png'), await sharp(Buffer.from(markSvg)).resize(1024, 1024).png().toBuffer())

const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="768" viewBox="0 0 1536 768">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0" stop-color="#141821"/><stop offset="1" stop-color="#050608"/>
    </radialGradient>
  </defs>
  <rect width="1536" height="768" fill="url(#glow)"/>
  <svg x="588" y="96" width="360" height="360" viewBox="588 211 360 360">${inner(markSvg)}</svg>
  <svg x="398" y="500" width="740" height="92" viewBox="-8 -8 936 116">${inner(wordmarkSvg).replaceAll('<path', '<path fill="none" stroke="#F4F5F7" stroke-width="13" stroke-miterlimit="1.5"').replace('<rect', '<rect fill="none" stroke="#F4F5F7" stroke-width="13"')}</svg>
  <text x="768" y="660" text-anchor="middle" fill="#9A9EA6" font-family="Segoe UI, Arial, sans-serif" font-size="30" letter-spacing="11">OPEN SOURCE DOWNLOADER</text>
</svg>`
await writeFile(join(root, 'docs', 'banner.png'), await png(banner))

console.log('Icons written: build/icon.ico, build/icon.png, resources/icons/*, docs/banner.png')
