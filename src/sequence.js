/**
 * sequence.js — HUD puppeteer while / after the forest grows
 *
 * On-screen story:
 *   1) Local temp + AQI with severity colors (red / orange / green) — CO₂ hidden
 *   2) After planting, those readings ease toward better severity
 *   3) Only then reveal CO₂ filtered; lock "Estimate from your trees & local air"
 *
 * Place data: ONLY reads window.__FA_PLACE_CACHE__ (filled before XR8.run).
 */

import { SPECIES_INFO } from './tree.js'
import { aqiBand } from './aqi.js'

let sequenceRunning = false
/** True once local baseline (temp + AQI) has been shown */
let baselineShown = false
/** True once the first grove HUD has locked its numbers */
let impactRevealDone = false

/** Young AR trees are not full mature yield */
const MATURITY = 0.35

const SEVERITY = {
  good: { rgb: [196, 255, 0], glow: '0 0 12px rgba(196, 255, 0, 0.45)' },
  moderate: { rgb: [255, 168, 48], glow: '0 0 12px rgba(255, 150, 40, 0.45)' },
  poor: { rgb: [255, 72, 40], glow: '0 0 14px rgba(255, 70, 40, 0.55)' },
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

function lerpChannel(a, b, t) {
  return Math.round(a + (b - a) * t)
}

function rgbCss(rgb, alpha = 1) {
  if (alpha >= 1) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}

function lerpRgb(a, b, t) {
  return [
    lerpChannel(a[0], b[0], t),
    lerpChannel(a[1], b[1], t),
    lerpChannel(a[2], b[2], t),
  ]
}

/** US AQI bands → the standard EPA band colour for that number. */
function aqiSeverityRgb(aqi) {
  return aqiBand(aqi).text
}

/**
 * Heat-focused temp bands (Malaysia-ish outdoor comfort).
 * Cool ≤27 green, warm ~30 orange, hot ≥34 red.
 */
function tempSeverityRgb(tempC) {
  const v = Number(tempC)
  if (!Number.isFinite(v) || v <= 27) return SEVERITY.good.rgb
  if (v <= 30) {
    const t = (v - 27) / 3
    return lerpRgb(SEVERITY.good.rgb, SEVERITY.moderate.rgb, t)
  }
  if (v <= 34) {
    const t = (v - 30) / 4
    return lerpRgb(SEVERITY.moderate.rgb, SEVERITY.poor.rgb, t)
  }
  return SEVERITY.poor.rgb
}

/** Glow matches the value's own colour so bands stay readable at a glance */
function severityGlow(rgb) {
  return `0 0 12px ${rgbCss(rgb, 0.45)}`
}

function applyTone(el, rgb) {
  if (!el) return
  el.style.color = rgbCss(rgb)
  el.style.textShadow = severityGlow(rgb)
}

function clearTone(el) {
  if (!el) return
  el.style.color = ''
  el.style.textShadow = ''
}

function setCo2Deferred(deferred) {
  const row = document.getElementById('co2-row')
  if (!row) return
  row.classList.toggle('is-deferred', deferred)
  row.setAttribute('aria-hidden', deferred ? 'true' : 'false')
}

function diminishingReturns(raw, cap) {
  return cap * (1 - Math.exp(-raw / cap))
}

function traitCaptureScore(traits) {
  if (!traits) return 0.55
  const sum =
    (traits.leafSurface ?? 0) +
    (traits.waxySurfaces ?? 0) +
    (traits.hairyTextures ?? 0) +
    (traits.leafDensity ?? 0)
  return sum / 400
}

/**
 * Build place context from the PREFETCH cache (set in app.js before XR8.run).
 */
async function resolvePlaceContext() {
  const cache = window.__FA_PLACE_CACHE__ || {}
  const coords = cache.coords || null

  let placeKey
  let baselineTemp
  let liveTemp = false
  let liveAqi = false
  let airStart

  if (coords) {
    const latBucket = coords.lat.toFixed(2)
    const lonBucket = coords.lon.toFixed(2)
    placeKey = `gps:${latBucket},${lonBucket}`

    if (typeof cache.liveTemp === 'number') {
      baselineTemp = cache.liveTemp
      liveTemp = true
    } else {
      const rand = mulberry32(hashString(placeKey))
      const absLat = Math.abs(coords.lat)
      baselineTemp = 37.5 - absLat * 0.32 + (rand() - 0.5) * 2.4
      baselineTemp = Math.min(40, Math.max(18, baselineTemp))
    }

    if (typeof cache.liveAqi === 'number' && Number.isFinite(cache.liveAqi)) {
      airStart = Math.round(cache.liveAqi)
      liveAqi = true
    }
  } else {
    placeKey = [
      'proxy',
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'tz',
      navigator.language || 'lang',
      String(screen.width),
      String(screen.height),
    ].join('|')
    const rand = mulberry32(hashString(placeKey))
    baselineTemp = 27 + rand() * 10
  }

  if (airStart == null) {
    const rand = mulberry32(hashString(`${placeKey}|aqi-fallback`))
    airStart = Math.round(55 + rand() * 40)
  }

  return {
    placeKey,
    hasGps: Boolean(coords),
    liveTemp,
    liveAqi,
    baselineTemp,
    airStart,
    placeLabel: cache.placeLabel || null,
    aqiSource: cache.aqiSource || (liveAqi ? 'Open-Meteo' : null),
  }
}

/**
 * Species-weighted modeled impact.
 * @param {{ sizeScale: number, treeType?: string }[]} treeMeta
 */
export function computeImpactFromTrees(treeMeta, place) {
  let co2Raw = 0
  let airRaw = 0
  let coolRaw = 0

  for (let i = 0; i < treeMeta.length; i++) {
    const size = treeMeta[i].sizeScale || 1
    const type = treeMeta[i].treeType || 'canopy'
    const info = SPECIES_INFO[type] || SPECIES_INFO.canopy
    const capture = traitCaptureScore(info.traits)
    const co2Rate = info.co2KgYear ?? 14

    co2Raw += co2Rate * size * MATURITY
    airRaw += size * capture * 2.4
    coolRaw += size * (info.traits.leafSurface / 100) * 0.09
  }

  const tempDrop = diminishingReturns(coolRaw, 2.2)
  // Higher caps so extra taps still visibly move the numbers
  const co2Kg = diminishingReturns(co2Raw, 95)
  const airDrop = diminishingReturns(airRaw, 48)
  const airEnd = Math.max(10, Math.round(place.airStart - airDrop))

  const baseline = Number(place.baselineTemp.toFixed(1))
  const drop = Number(tempDrop.toFixed(1))

  return {
    treeCount: treeMeta.length,
    baselineTemp: baseline,
    tempDrop: drop,
    finalTemp: Number((baseline - drop).toFixed(1)),
    co2Kg: Number(co2Kg.toFixed(1)),
    airStart: place.airStart,
    airEnd,
    liveTemp: place.liveTemp,
    liveAqi: place.liveAqi,
    hasGps: place.hasGps,
    placeLabel: place.placeLabel,
    aqiSource: place.aqiSource,
  }
}

/** Headline of the dashboard: where these readings come from. */
function updatePlaceLabel(impact) {
  const el = document.getElementById('place-label')
  if (!el) return
  if (!impact.hasGps) {
    el.textContent = 'Location off'
    return
  }
  el.textContent = impact.placeLabel || 'Your area'
}

function startStatusPulse() {
  const dot = document.getElementById('status-dot')
  if (!dot || typeof window.anime !== 'function') return
  window.anime({
    targets: dot,
    opacity: [1, 0.2],
    duration: 800,
    direction: 'alternate',
    loop: true,
    easing: 'easeInOutSine',
  })
}

function showDashboard() {
  const dashboard = document.getElementById('dashboard')
  if (!dashboard) return
  dashboard.setAttribute('aria-hidden', 'false')
  if (dashboard.classList.contains('is-visible')) return
  // display:none → block, then animate opacity on the next frame
  dashboard.classList.add('is-visible')
  dashboard.style.opacity = '0'
  dashboard.style.transform = 'translateY(-12px)'
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dashboard.style.opacity = ''
      dashboard.style.transform = ''
    })
  })
}

function setStatus(text) {
  const statusMsg = document.getElementById('status-message')
  const statusDot = document.getElementById('status-dot')
  if (statusMsg) statusMsg.textContent = text
  if (statusDot) {
    statusDot.style.background = '#c4ff00'
    statusDot.style.boxShadow = '0 0 10px #c4ff00'
  }
}

function paintLocalReadings(impact, els) {
  const { tempVal, aqiVal } = els
  if (tempVal) {
    tempVal.textContent = `${impact.baselineTemp.toFixed(1)}°C`
    tempVal.classList.add('warning')
    tempVal.classList.remove('drop')
    applyTone(tempVal, tempSeverityRgb(impact.baselineTemp))
  }
  if (aqiVal) {
    aqiVal.textContent = `${impact.airStart}`
    aqiVal.classList.add('warning')
    aqiVal.classList.remove('drop')
    applyTone(aqiVal, aqiSeverityRgb(impact.airStart))
  }
}

function paintLockedImpact(impact, els) {
  const { tempVal, co2Val, aqiVal } = els

  if (tempVal) {
    const fromRgb = tempSeverityRgb(impact.baselineTemp)
    const toRgb = tempSeverityRgb(impact.finalTemp)
    tempVal.innerHTML =
      `<span class="stat-from" style="color:${rgbCss(fromRgb, 0.9)}">${impact.baselineTemp.toFixed(1)}°C</span>` +
      `<span class="stat-arrow">→</span>` +
      `<span class="stat-to" style="color:${rgbCss(toRgb)}">${impact.finalTemp.toFixed(1)}°C</span>`
    tempVal.classList.remove('warning')
    tempVal.classList.add('drop')
    clearTone(tempVal)
  }

  if (aqiVal) {
    const fromRgb = aqiSeverityRgb(impact.airStart)
    const toRgb = aqiSeverityRgb(impact.airEnd)
    aqiVal.innerHTML =
      `<span class="aqi-from" style="color:${rgbCss(fromRgb, 0.9)}">${impact.airStart}</span>` +
      `<span class="aqi-arrow">→</span>` +
      `<span class="aqi-to" style="color:${rgbCss(toRgb)}">${impact.airEnd}</span>`
    aqiVal.classList.remove('warning')
    aqiVal.classList.add('drop')
    clearTone(aqiVal)
  }

  if (co2Val) {
    co2Val.textContent = `${impact.co2Kg.toFixed(1)} kg/year`
    co2Val.classList.remove('warning')
    co2Val.classList.add('drop')
    clearTone(co2Val)
  }

  setCo2Deferred(false)
}

function statusLocal(impact) {
  if (!impact.hasGps) return 'Turn on location for local readings'
  if (impact.liveTemp && impact.liveAqi) return 'Live temp & AQI · Open-Meteo'
  if (impact.liveTemp) return 'Live temp · Open-Meteo'
  if (impact.liveAqi) return 'Live AQI · Open-Meteo'
  return 'Estimated local readings'
}

function statusWorking() {
  return 'Trees working…'
}

function statusLocked(impact) {
  if (impact.hasGps) return 'Estimate from your trees & local air'
  return 'Estimate from your trees'
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/**
 * Show local temp + AQI (severity colors) before planting. CO₂ stays hidden.
 */
export async function showLocalBaseline() {
  const tempVal = document.getElementById('temp-val')
  const aqiVal = document.getElementById('aqi-val')
  const co2Val = document.getElementById('co2-val')

  startStatusPulse()
  const place = await resolvePlaceContext()
  const impact = computeImpactFromTrees([], place)

  showDashboard()
  setCo2Deferred(true)
  if (co2Val) {
    co2Val.textContent = '—'
    co2Val.classList.add('warning')
    co2Val.classList.remove('drop')
  }
  setStatus(statusLocal(impact))
  updatePlaceLabel(impact)
  paintLocalReadings(impact, { tempVal, aqiVal })
  baselineShown = true
}

function animateImprovement(impact, durationMs, els) {
  const { tempVal, aqiVal } = els
  const t0 = performance.now()

  paintLocalReadings(impact, els)

  return new Promise((resolve) => {
    const tick = (now) => {
      const u = Math.min(1, (now - t0) / durationMs)
      const e = easeOutCubic(u)

      const tempNow = impact.baselineTemp - impact.tempDrop * e
      const airNow = Math.round(
        impact.airStart + (impact.airEnd - impact.airStart) * e
      )

      if (tempVal) {
        tempVal.textContent = `${tempNow.toFixed(1)}°C`
        applyTone(tempVal, tempSeverityRgb(tempNow))
      }
      if (aqiVal) {
        aqiVal.textContent = `${airNow}`
        applyTone(aqiVal, aqiSeverityRgb(airNow))
      }

      if (u < 1) {
        requestAnimationFrame(tick)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

function revealCo2(impact, co2Val) {
  setCo2Deferred(false)
  if (!co2Val) return Promise.resolve()

  co2Val.textContent = '0.0 kg/year'
  co2Val.classList.add('warning')
  co2Val.classList.remove('drop')

  const durationMs = 1400
  const t0 = performance.now()
  return new Promise((resolve) => {
    const tick = (now) => {
      const u = Math.min(1, (now - t0) / durationMs)
      const e = easeOutCubic(u)
      co2Val.textContent = `${(impact.co2Kg * e).toFixed(1)} kg/year`
      if (u < 1) requestAnimationFrame(tick)
      else {
        co2Val.classList.remove('warning')
        co2Val.classList.add('drop')
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

/**
 * @param {{ sizeScale: number, treeType?: string }[]} treeMeta
 */
export async function playAwakeningSequence(treeMeta) {
  if (sequenceRunning) return
  sequenceRunning = true

  const tempVal = document.getElementById('temp-val')
  const co2Val = document.getElementById('co2-val')
  const aqiVal = document.getElementById('aqi-val')

  startStatusPulse()
  const placePromise = resolvePlaceContext()

  window.setTimeout(async () => {
    const place = await placePromise
    const impact = computeImpactFromTrees(treeMeta, place)

    showDashboard()
    setCo2Deferred(true)
    updatePlaceLabel(impact)

    // Beat 1: local severity first (skip long hold if already shown pre-plant)
    if (!baselineShown) {
      setStatus(statusLocal(impact))
      paintLocalReadings(impact, { tempVal, aqiVal })
      baselineShown = true
      await wait(1800)
    } else {
      paintLocalReadings(impact, { tempVal, aqiVal })
      await wait(500)
    }

    // Beat 2: trees improve temp + AQI (colors follow severity of the live value)
    setStatus(statusWorking())
    await animateImprovement(impact, 5500, { tempVal, aqiVal })

    const finalImpact = computeImpactFromTrees(treeMeta, place)

    // Beat 3: only now reveal CO₂
    setStatus(statusLocked(finalImpact))
    updatePlaceLabel(finalImpact)
    paintLockedImpact(finalImpact, { tempVal, aqiVal, co2Val: null })
    await revealCo2(finalImpact, co2Val)
    paintLockedImpact(finalImpact, { tempVal, co2Val, aqiVal })

    impactRevealDone = true
  }, baselineShown ? 400 : 2200)
}

/**
 * Bumps dashboard numbers when more trees are planted.
 * Safe during/after the first reveal — does not require the CSS lock class.
 * @param {{ sizeScale: number, treeType?: string }[]} allTreeMeta
 */
export async function refreshImpactDisplay(allTreeMeta) {
  const dashboard = document.getElementById('dashboard')
  const tempVal = document.getElementById('temp-val')
  const co2Val = document.getElementById('co2-val')
  const aqiVal = document.getElementById('aqi-val')
  const statusMsg = document.getElementById('status-message')

  if (!dashboard || !dashboard.classList.contains('is-visible')) return
  if (!tempVal) return

  const place = await resolvePlaceContext()
  const impact = computeImpactFromTrees(allTreeMeta, place)

  paintLockedImpact(impact, { tempVal, co2Val, aqiVal })
  if (statusMsg) statusMsg.textContent = statusLocked(impact)
  updatePlaceLabel(impact)
  impactRevealDone = true
  baselineShown = true
}
