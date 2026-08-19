/**
 * app.js — Boot sequence for Forest Awakening WebAR
 *
 * Order of operations (matters for anchoring):
 *   1. Wait for XR8 + XRExtras
 *   2. Show loading UI
 *   3. Prefetch GPS + Open-Meteo temp INTO window.__FA_PLACE_CACHE__
 *      (MUST happen before the camera — a mid-AR location prompt pauses
 *       WebGL and can make planted trees drift / jitter)
 *   4. Register camera pipeline (feed + Three.js + SLAM)
 *   5. XR8.run() → camera + world tracking
 *
 * After this file, scene.js owns tap → forest, sequence.js owns the HUD.
 */

import * as THREE from 'three'
import { initForestPipelineModule } from './scene.js'

// XR8.Threejs expects THREE on window (official 8th Wall placeground pattern)
window.THREE = { ...THREE }

if (THREE.ColorManagement) {
  THREE.ColorManagement.enabled = false
}

/** Read by sequence.js — never refetch GPS during AR */
window.__FA_PLACE_CACHE__ = null

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
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 180000 }
    )
  })
}

async function prefetchPlaceContext() {
  const coords = await getGpsCoords()
  if (coords) {
    const live = await fetchLiveTemperature(coords.lat, coords.lon)
    window.__FA_PLACE_CACHE__ = {
      coords,
      liveTemp: live,
      fetchedAt: Date.now(),
    }
  } else {
    window.__FA_PLACE_CACHE__ = {
      coords: null,
      liveTemp: null,
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

const setupDesktopSplash = () => {
  const splashScreen = document.getElementById('splash-screen')
  const startBtn = document.getElementById('start-ar-button')
  const disclaimer = document.querySelector('.splash-disclaimer')
  const title = document.querySelector('.splash-title')
  const text = document.querySelector('.splash-text')
  const qrContainer = document.getElementById('desktop-qr-container')
  const qrImage = document.getElementById('desktop-qr-code')

  if (splashScreen) {
    splashScreen.classList.remove('hidden')
    splashScreen.style.opacity = '1'
    splashScreen.style.pointerEvents = 'auto'
  }

  if (startBtn) startBtn.style.display = 'none'
  if (disclaimer) disclaimer.style.display = 'none'

  if (title) title.textContent = 'Desktop Detected'
  if (text) {
    text.innerHTML =
      'This WebAR experience requires a mobile device camera.<br/><br/>Please scan the QR code below to enter the forest.'
  }

  if (qrImage) {
    qrImage.src =
      `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=` +
      encodeURIComponent(window.location.href)
  }
  if (qrContainer) qrContainer.classList.remove('hidden')
}

const dismissSplash = () => {
  const splashScreen = document.getElementById('splash-screen')
  if (!splashScreen) return
  splashScreen.style.opacity = '0'
  splashScreen.style.pointerEvents = 'none'
  window.setTimeout(() => {
    splashScreen.classList.add('hidden')
  }, 400)
}

let experienceStarted = false

const startExperience = () => {
  if (experienceStarted || !window.XRExtras || !window.XR8) return
  experienceStarted = true
  XRExtras.Loading.showLoading({ onxrloaded: onXrLoaded })
}

const armStartButton = () => {
  if (!isMobileDevice()) return
  const startBtn = document.getElementById('start-ar-button')
  if (!startBtn || startBtn.dataset.armed === 'true') return
  if (!window.XRExtras || !window.XR8) return

  startBtn.dataset.armed = 'true'
  startBtn.disabled = false
  startBtn.textContent = 'START AR'
  startBtn.addEventListener('click', () => {
    if (startBtn.disabled) return
    startBtn.disabled = true
    dismissSplash()
    startExperience()
  })
}

if (!isMobileDevice()) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDesktopSplash)
  } else {
    setupDesktopSplash()
  }
} else {
  window.addEventListener('xrextrasloaded', armStartButton)
  window.addEventListener('xrloaded', armStartButton)
  window.addEventListener('load', armStartButton)
  armStartButton()
}
