/**
 * sequence.js — HUD puppeteer while / after the forest grows
 *
 * On-screen story:
 *   1) Dashboard with local starting temp + AQI (from app.js Open-Meteo cache)
 *   2) While trees grow, numbers ease using species-weighted model estimates
 *   3) Lock "Estimate from your trees"
 *
 * Place data: ONLY reads window.__FA_PLACE_CACHE__ (filled before XR8.run).
 */

import { SPECIES_INFO } from './tree.js'

let sequenceRunning = false
/** True once the first grove HUD has locked its numbers */
let impactRevealDone = false

/** Young AR trees are not full mature yield */
const MATURITY = 0.35

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
  const airEnd = Math.max(
    10,
    Math.round(place.airStart - airDrop)
  )

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

function updateAqiSublabel(impact) {
  const el = document.getElementById('aqi-sublabel')
  if (!el) return

  if (!impact.hasGps) {
    el.textContent = 'Turn on location to read your area’s AQI'
    el.classList.add('is-warn')
    return
  }

  const area = impact.placeLabel || 'Your area'
  if (impact.liveAqi && impact.aqiSource) {
    el.textContent = `${area} · via ${impact.aqiSource}`
    el.classList.remove('is-warn')
    return
  }

  el.textContent = `${area} · location on, AQI unavailable`
  el.classList.remove('is-warn')
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

function animateLiveStats(impact, durationMs, els) {
  const { tempVal, co2Val, aqiVal } = els
  const t0 = performance.now()

  if (tempVal) {
    tempVal.textContent = `${impact.baselineTemp.toFixed(1)}°C`
    tempVal.classList.add('warning')
    tempVal.classList.remove('drop')
  }
  if (co2Val) {
    co2Val.textContent = '0.0 kg/year'
    co2Val.classList.add('warning')
    co2Val.classList.remove('drop')
  }
  if (aqiVal) {
    aqiVal.textContent = `${impact.airStart}`
    aqiVal.classList.add('warning')
    aqiVal.classList.remove('drop')
  }

  return new Promise((resolve) => {
    const tick = (now) => {
      const u = Math.min(1, (now - t0) / durationMs)
      const e = easeOutCubic(u)

      const tempNow = impact.baselineTemp - impact.tempDrop * e
      const co2Now = impact.co2Kg * e
      const airNow = Math.round(
        impact.airStart + (impact.airEnd - impact.airStart) * e
      )

      if (tempVal) tempVal.textContent = `${tempNow.toFixed(1)}°C`
      if (co2Val) co2Val.textContent = `${co2Now.toFixed(1)} kg/year`
      if (aqiVal) aqiVal.textContent = `${airNow}`

      if (u < 1) {
        requestAnimationFrame(tick)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

function statusWorking(impact) {
  if (impact.liveTemp && impact.liveAqi) return 'Trees working · live local air'
  if (impact.liveTemp) return 'Trees working · live temp'
  if (impact.liveAqi) return 'Trees working · live AQI'
  return 'Trees working…'
}

function statusLocked(impact) {
  if (impact.hasGps) return 'Estimate from your trees · local air'
  return 'Estimate from your trees'
}

/**
 * @param {{ sizeScale: number, treeType?: string }[]} treeMeta
 */
export async function playAwakeningSequence(treeMeta) {
  if (sequenceRunning) return
  sequenceRunning = true

  const dashboard = document.getElementById('dashboard')
  const statusMsg = document.getElementById('status-message')
  const statusDot = document.getElementById('status-dot')
  const tempVal = document.getElementById('temp-val')
  const co2Val = document.getElementById('co2-val')
  const aqiVal = document.getElementById('aqi-val')

  startStatusPulse()

  const placePromise = resolvePlaceContext()

  window.setTimeout(async () => {
    const place = await placePromise
    const impact = computeImpactFromTrees(treeMeta, place)

    if (dashboard) {
      dashboard.classList.add('is-visible')
      dashboard.setAttribute('aria-hidden', 'false')
    }
    if (statusMsg) {
      statusMsg.textContent = statusWorking(impact)
      statusMsg.style.color = '#c4ff00'
    }
    if (statusDot) {
      statusDot.style.background = '#c4ff00'
      statusDot.style.boxShadow = '0 0 10px #c4ff00'
    }
    updateAqiSublabel(impact)

    await animateLiveStats(impact, 6000, { tempVal, co2Val, aqiVal })

    const finalImpact = computeImpactFromTrees(treeMeta, place)

    if (statusMsg) {
      statusMsg.textContent = statusLocked(finalImpact)
      statusMsg.style.color = '#c4ff00'
    }
    if (statusDot) {
      statusDot.style.background = '#c4ff00'
      statusDot.style.boxShadow = '0 0 10px #c4ff00'
    }
    updateAqiSublabel(finalImpact)

    if (tempVal) {
      tempVal.innerHTML =
        `${finalImpact.baselineTemp.toFixed(1)}°C <span style="font-size:14px">→</span> ${finalImpact.finalTemp.toFixed(1)}°C`
      tempVal.classList.remove('warning')
      tempVal.classList.add('drop')
    }
    if (co2Val) {
      co2Val.textContent = `${finalImpact.co2Kg.toFixed(1)} kg/year`
      co2Val.classList.remove('warning')
      co2Val.classList.add('drop')
    }
    if (aqiVal) {
      aqiVal.innerHTML =
        `<span class="aqi-from">${finalImpact.airStart}</span><span class="aqi-arrow">→</span>${finalImpact.airEnd}`
      aqiVal.classList.remove('warning')
      aqiVal.classList.add('drop')
    }

    impactRevealDone = true
  }, 2200)
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

  tempVal.innerHTML =
    `${impact.baselineTemp.toFixed(1)}°C <span style="font-size:14px">→</span> ${impact.finalTemp.toFixed(1)}°C`
  tempVal.classList.remove('warning')
  tempVal.classList.add('drop')

  if (co2Val) {
    co2Val.textContent = `${impact.co2Kg.toFixed(1)} kg/year`
    co2Val.classList.remove('warning')
    co2Val.classList.add('drop')
  }
  if (aqiVal) {
    aqiVal.innerHTML =
      `<span class="aqi-from">${impact.airStart}</span><span class="aqi-arrow">→</span>${impact.airEnd}`
    aqiVal.classList.remove('warning')
    aqiVal.classList.add('drop')
  }
  if (statusMsg) statusMsg.textContent = statusLocked(impact)
  updateAqiSublabel(impact)
  impactRevealDone = true
}
