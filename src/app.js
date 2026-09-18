/**
 * app.js — Boot sequence for Forest Awakening WebAR
 *
 * Order of operations (matters for anchoring):
 *   1. Wait for XR8 + XRExtras
 *   2. 8th Wall loading UI (Far Out logo stays top-right)
 *   3. Prefetch GPS + Open-Meteo temp INTO window.__FA_PLACE_CACHE__
 *      (MUST happen before the camera — a mid-AR location prompt pauses
 *       WebGL and can make planted trees drift / jitter)
 *   4. Register camera pipeline (feed + Three.js + SLAM)
 *   5. XR8.run() → camera + world tracking
 *   6. When tracking is live, show splash → START AR → HUD
 *
 * After this file, scene.js owns tap → forest, sequence.js owns the HUD.
 */

import * as THREE from 'three'
import { initForestPipelineModule } from './scene.js'
import {
  initSpeciesPanel,
  showSpeciesInfoButton,
} from './species-panel.js'
import { initHowtoModal, showHowtoModal } from './howto-modal.js'
import { showLocalBaseline } from './sequence.js'
import { aqiBand, readingPlaceName } from './aqi.js'

// XR8.Threejs expects THREE on window (official 8th Wall placeground pattern)
window.THREE = { ...THREE }

if (THREE.ColorManagement) {
  THREE.ColorManagement.enabled = false
}

/** Read by sequence.js — never refetch GPS during AR */
window.__FA_PLACE_CACHE__ = null

/** Tap-to-plant stays off until START AR dismisses the splash */
window.__FA_SPLASH_DISMISSED__ = false

/** Planting stays off until the how-to modal is finished */
window.__FA_HOWTO_DONE__ = false

/** API: Open-Meteo current temperature (no API key). Docs: https://open-meteo.com/ */
function fetchLiveTemperature(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current=temperature_2m`
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const t = data?.current?.temperature_2m
      return typeof t === 'number' && Number.isFinite(t) ? t : null
    })
    .catch(() => null)
}

/** API: Open-Meteo air quality (US AQI). Docs: https://open-meteo.com/en/docs/air-quality-api */
function fetchLiveAqi(lat, lon) {
  const url =
    `https://air-quality-api.open-meteo.com/v1/air-quality` +
    `?latitude=${encodeURIComponent(lat)}` +
    `&longitude=${encodeURIComponent(lon)}` +
    `&current=us_aqi`
  return fetch(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const aqi = data?.current?.us_aqi
      return typeof aqi === 'number' && Number.isFinite(aqi) ? aqi : null
    })
    .catch(() => null)
}

/** Reverse-geocode GPS → area label via OpenStreetMap Nominatim. */
function fetchPlaceLabel(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}` +
    `&format=jsonv2` +
    `&addressdetails=1` +
    `&zoom=14` +
    `&accept-language=en`
  return fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return null
      const a = data.address || {}
      const area =
        a.suburb ||
        a.neighbourhood ||
        a.city_district ||
        a.city ||
        a.town ||
        a.village ||
        a.municipality ||
        a.county ||
        null
      const region = a.state || a.region || null
      const country = a.country || null

      // Prefer "Suburb, City" or "City, Country" — skip repeating same name
      const parts = []
      if (area) parts.push(area)
      if (region && region !== area) parts.push(region)
      else if (country && country !== area) parts.push(country)

      if (parts.length) return parts.slice(0, 2).join(', ')
      if (data.name) return data.name
      return null
    })
    .catch(() => null)
}

function getGpsCoords() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  })
}

async function prefetchPlaceContext() {
  const coords = await getGpsCoords()
  if (coords) {
    const [liveTemp, liveAqi, placeLabel] = await Promise.all([
      fetchLiveTemperature(coords.lat, coords.lon),
      fetchLiveAqi(coords.lat, coords.lon),
      fetchPlaceLabel(coords.lat, coords.lon),
    ])
    window.__FA_PLACE_CACHE__ = {
      coords,
      liveTemp,
      liveAqi,
      placeLabel:
        placeLabel ||
        `${coords.lat.toFixed(2)}°, ${coords.lon.toFixed(2)}°`,
      aqiSource: 'Open-Meteo',
      fetchedAt: Date.now(),
    }
  } else {
    window.__FA_PLACE_CACHE__ = {
      coords: null,
      liveTemp: null,
      liveAqi: null,
      placeLabel: null,
      aqiSource: null,
      fetchedAt: Date.now(),
    }
  }
}

const onXrLoaded = async () => {
  // Still on loading screen — safe time for permission dialogs
  await prefetchPlaceContext()

  XR8.addCameraPipelineModules([
    // Live camera as AR background
    XR8.GlTextureRenderer.pipelineModule(),
    // Three.js scene driven by device pose each frame
    XR8.Threejs.pipelineModule(),
    // SLAM — trees stay at fixed world points while this updates the camera
    XR8.XrController.pipelineModule(),
    window.LandingPage
      ? window.LandingPage.pipelineModule()
      : XRExtras.AlmostThere.pipelineModule(),
    XRExtras.FullWindowCanvas.pipelineModule(),
    XRExtras.Loading.pipelineModule(),
    XRExtras.RuntimeError.pipelineModule(),
    splashGatePipelineModule(),
    // Our dense forest + HUD hand-off
    initForestPipelineModule(),
  ])

  const canvas = document.getElementById('camerafeed')
  if (!canvas) {
    console.error('[Forest Awakening] Missing #camerafeed canvas')
    return
  }

  // Opens camera. Requires HTTPS (Vercel / ngrok / localhost).
  XR8.run({
    canvas,
    allowedDevices: XR8.XrConfig.device().ANY,
  })
}

const isMobileDevice = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  )

function paintSplashAqi() {
  const meta = document.getElementById('splash-aqi-meta')
  const num = document.getElementById('splash-aqi-num')
  const status = document.getElementById('splash-aqi-status')
  if (!meta || !num || !status) return

  const cache = window.__FA_PLACE_CACHE__ || {}
  const place =
    cache.placeLabel ||
    (cache.coords
      ? `${cache.coords.lat.toFixed(2)}°, ${cache.coords.lon.toFixed(2)}°`
      : null)
  const aqi = cache.liveAqi

  if (typeof aqi === 'number' && Number.isFinite(aqi)) {
    const band = aqiBand(aqi)
    const area = (readingPlaceName(place) || 'Your area').toUpperCase()
    meta.textContent = `${area} · LIVE AQI`
    num.textContent = String(Math.round(aqi))
    num.style.color = `rgb(${band.text.join(',')})`
    status.textContent = band.splashLine
    return
  }

  if (cache.coords) {
    meta.textContent = `${(readingPlaceName(place) || 'Your area').toUpperCase()} · AQI`
    num.textContent = '—'
    num.style.color = ''
    status.textContent = 'Location on, AQI unavailable right now.'
    return
  }

  meta.textContent = 'LOCATION OFF · AQI'
  num.textContent = '—'
  num.style.color = ''
  status.textContent = 'Turn on location to read the air around you.'
}

const setupDesktopSplash = () => {
  const splashScreen = document.getElementById('splash-screen')
  const startBtn = document.getElementById('start-ar-button')
  const aqiBlock = document.getElementById('splash-aqi-block')
  const splashIntro = document.getElementById('splash-intro')
  const splashHeader = document.querySelector('.splash-header')
  const desktopCopy = document.getElementById('desktop-splash-copy')
  const footer = document.querySelector('.splash-footer')
  const qrContainer = document.getElementById('desktop-qr-container')
  const qrImage = document.getElementById('desktop-qr-code')

  if (splashScreen) {
    splashScreen.classList.remove('hidden')
    splashScreen.style.opacity = '1'
    splashScreen.style.pointerEvents = 'auto'
  }

  if (startBtn) startBtn.style.display = 'none'
  if (aqiBlock) aqiBlock.style.display = 'none'
  if (splashIntro) splashIntro.style.display = 'none'
  if (splashHeader) splashHeader.style.display = 'none'
  if (footer) footer.style.display = 'none'
  if (desktopCopy) desktopCopy.classList.remove('hidden')

  if (qrImage) {
    qrImage.src =
      `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=` +
      encodeURIComponent(window.location.href)
  }
  if (qrContainer) qrContainer.classList.remove('hidden')
}

const splashGatePipelineModule = () => ({
  name: 'canopy-splash-gate',
  onStart: () => {
    revealSplashAfterLoad()
  },
})

const revealSplashAfterLoad = () => {
  const splashScreen = document.getElementById('splash-screen')
  const startBtn = document.getElementById('start-ar-button')
  if (!splashScreen || !startBtn) return

  splashScreen.classList.remove('hidden')
  splashScreen.style.opacity = '1'
  splashScreen.style.pointerEvents = 'auto'

  startBtn.disabled = false
  startBtn.textContent = 'START AR'
  paintSplashAqi()

  if (startBtn.dataset.armed === 'true') return
  startBtn.dataset.armed = 'true'
  startBtn.addEventListener('click', () => {
    if (startBtn.disabled) return
    startBtn.disabled = true
    window.__FA_SPLASH_DISMISSED__ = true
    dismissSplash()
  })
}

const dismissSplash = () => {
  const splashScreen = document.getElementById('splash-screen')
  if (splashScreen) {
    splashScreen.style.opacity = '0'
    splashScreen.style.pointerEvents = 'none'
    window.setTimeout(() => {
      splashScreen.classList.add('hidden')
      showHowtoModal()
    }, 400)
  } else {
    showHowtoModal()
  }
}

let experienceStarted = false

const startExperience = () => {
  if (experienceStarted || !window.XRExtras || !window.XR8) return
  experienceStarted = true
  initSpeciesPanel()
  initHowtoModal({
    onDone: () => {
      const instruction = document.getElementById('instruction')
      if (instruction) instruction.classList.remove('hidden')
      showSpeciesInfoButton()
      // Local severity first — CO₂ waits until trees improve readings
      showLocalBaseline()
    },
  })
  XRExtras.Loading.showLoading({ onxrloaded: onXrLoaded })
}

if (!isMobileDevice()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initSpeciesPanel()
      initHowtoModal()
      setupDesktopSplash()
    })
  } else {
    initSpeciesPanel()
    initHowtoModal()
    setupDesktopSplash()
  }
  // Desktop can open the species compare panel without AR
  window.setTimeout(() => showSpeciesInfoButton(), 0)
} else {
  window.addEventListener('xrextrasloaded', startExperience)
  window.addEventListener('xrloaded', startExperience)
  window.addEventListener('load', startExperience)
  startExperience()
}
