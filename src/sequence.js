/**
 * sequence.js — HUD puppeteer while / after the forest grows
 *
 * On-screen story:
 *   1) Dashboard with local starting temp (from app.js cache / Open-Meteo)
 *   2) While trees grow, numbers ease: temp ↓ a little, CO₂ kg ↑, air index ↓
 *   3) Lock "Impact verified"
 *   4) Hide dashboard → bottom brand lockup (Far Out logo, then Forest Awakening)
 *
 * Place data: ONLY reads window.__FA_PLACE_CACHE__ (filled before XR8.run).
 * Does NOT call geolocation here — mid-AR prompts broke SLAM anchoring.
 */

let sequenceRunning = false

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

/** Ease 0→1 with a soft ease-out so the last seconds settle calmly */
function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

/**
 * Real API used from app.js prefetch (Open-Meteo). Sequence only reads the cache.
 * CO₂ / air index are theatrical but place-seeded so cities don't all match.
 */

/**
 * Build place context from the PREFETCH cache (set in app.js before XR8.run).
 * Never calls geolocation here — that mid-AR prompt was breaking SLAM anchoring.
 */
async function resolvePlaceContext() {
  const cache = window.__FA_PLACE_CACHE__ || {}
  const coords = cache.coords || null

  let placeKey
  let baselineTemp
  let liveTemp = false

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

  const rand = mulberry32(hashString(`${placeKey}|gentle-rates`))

  const tempPerSize = 0.055 + rand() * 0.04
  const co2PerSize = 1.6 + rand() * 1.1
  const airStart = Math.round(72 + rand() * 22)
  const airDropPerSize = 1.8 + rand() * 1.2

  return {
    placeKey,
    hasGps: Boolean(coords),
    liveTemp,
    baselineTemp,
    tempPerSize,
    co2PerSize,
    airStart,
    airDropPerSize,
  }
}

/**
 * Per-tree sum → modest totals (capped so nothing looks fake-crazy).
 * @param {{ sizeScale: number }[]} treeMeta
 * @param {Awaited<ReturnType<typeof resolvePlaceContext>>} place
 */
export function computeImpactFromTrees(treeMeta, place) {
  let tempDrop = 0
  let co2Kg = 0
  let airDrop = 0

  for (let i = 0; i < treeMeta.length; i++) {
    const size = treeMeta[i].sizeScale
    tempDrop += size * place.tempPerSize
    co2Kg += size * place.co2PerSize
    airDrop += size * place.airDropPerSize
  }

  // Soft caps — noticeable, not exaggerated
  tempDrop = Math.min(tempDrop, 2.1)
  co2Kg = Math.min(co2Kg, 38)
  const airEnd = Math.max(28, Math.round(place.airStart - Math.min(airDrop, 38)))

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
    hasGps: place.hasGps,
  }
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

/**
 * Tick HUD numbers from start → end while the AR forest is growing.
 * @param {ReturnType<typeof computeImpactFromTrees>} impact
 * @param {number} durationMs
 */
function animateLiveStats(impact, durationMs, els) {
  const { tempVal, co2Val, aqiVal } = els
  const t0 = performance.now()

  // Start state: real/local temp, 0 kg filtered, higher air index
  if (tempVal) {
    tempVal.textContent = `${impact.baselineTemp.toFixed(1)}°C`
    tempVal.classList.add('warning')
    tempVal.classList.remove('drop')
  }
  if (co2Val) {
    co2Val.textContent = '0.0 kg'
    co2Val.classList.add('warning')
    co2Val.classList.remove('drop')
  }
  if (aqiVal) {
    aqiVal.textContent = `INDEX ${impact.airStart}`
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
      if (co2Val) co2Val.textContent = `${co2Now.toFixed(1)} kg`
      if (aqiVal) aqiVal.textContent = `INDEX ${airNow}`

      if (u < 1) {
        requestAnimationFrame(tick)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
}

/**
 * @param {{ sizeScale: number }[]} treeMeta
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
  const reveal = document.getElementById('reveal')
  const privacy = document.getElementById('privacy')

  if (privacy) privacy.classList.add('is-hidden')
  startStatusPulse()

  // Fetch GPS + Open-Meteo ASAP so the dashboard can open with real-ish numbers
  const placePromise = resolvePlaceContext()

  // —— Beat 1: show dashboard with live starting values, then ease during growth ——
  window.setTimeout(async () => {
    const place = await placePromise
    const impact = computeImpactFromTrees(treeMeta, place)

    if (dashboard) {
      dashboard.classList.add('is-visible')
      dashboard.setAttribute('aria-hidden', 'false')
    }
    if (statusMsg) {
      statusMsg.textContent = impact.liveTemp
        ? 'Live local temp · forest working…'
        : 'Local estimate · forest working…'
      statusMsg.style.color = '#ffdd00'
    }
    if (statusDot) {
      statusDot.style.background = '#ffdd00'
      statusDot.style.boxShadow = '0 0 10px #ffdd00'
    }

    // Animate for ~6s so it tracks the slower grow window (dashboard ~2.2s → ~8.2s)
    await animateLiveStats(impact, 6000, { tempVal, co2Val, aqiVal })

    // —— Beat 2: lock the final readout ——
    if (statusMsg) {
      statusMsg.textContent = impact.hasGps
        ? 'Impact verified · local zone'
        : 'Impact verified'
      statusMsg.style.color = '#00ffaa'
    }
    if (statusDot) {
      statusDot.style.background = '#00ffaa'
      statusDot.style.boxShadow = '0 0 10px #00ffaa'
    }

    if (tempVal) {
      tempVal.innerHTML =
        `${impact.baselineTemp.toFixed(1)}°C <span style="font-size:14px">→</span> ${impact.finalTemp.toFixed(1)}°C`
      tempVal.classList.remove('warning')
      tempVal.classList.add('drop')
    }
    if (co2Val) {
      co2Val.textContent = `${impact.co2Kg.toFixed(1)} kg`
      co2Val.classList.remove('warning')
      co2Val.classList.add('drop')
    }
    if (aqiVal) {
      aqiVal.innerHTML =
        `<span style="opacity:0.55;font-size:11px">${impact.airStart} →</span> ${impact.airEnd} · CLEARER`
      aqiVal.classList.remove('warning')
      aqiVal.classList.add('drop')
    }
  }, 2200)

  // —— Beat 3: bottom brand lockup; hide dashboard so nothing overlaps ——
  window.setTimeout(() => {
    if (dashboard) {
      dashboard.classList.remove('is-visible')
      dashboard.classList.add('is-hidden')
      dashboard.setAttribute('aria-hidden', 'true')
    }
    if (reveal) {
      reveal.classList.add('is-visible')
      reveal.setAttribute('aria-hidden', 'false')
    }
  }, 9500)
}
