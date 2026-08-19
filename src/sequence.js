/**
 * sequence.js — HUD puppeteer while / after the forest grows
 *
 * On-screen story:
 *   1) Dashboard with local starting temp (from app.js cache / Open-Meteo)
 *   2) While trees grow, numbers ease: temp ↓ a little, CO₂ kg ↑, air index ↓
 *   3) Lock "Impact verified"
 *   4) Keep dashboard visible + show bottom brand lockup (Far Out logo, then Forest Awakening)
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
 * Smooth diminishing-returns curve: keeps climbing as more trees are
 * planted (so the dashboard stays "alive" across many taps) but each
 * additional tree matters less and less, so it eases toward `cap` instead
 * of hard-clipping to it — no sudden jump to a maxed-out, exaggerated
 * number after just a couple of extra plantings.
 */
function diminishingReturns(totalSize, perSize, cap) {
  const raw = totalSize * perSize
  return cap * (1 - Math.exp(-raw / cap))
}

/**
 * Per-tree sum → modest totals that keep moving (not capped-and-frozen)
 * as more groves get planted, but never feel exaggerated.
 * @param {{ sizeScale: number }[]} treeMeta
 * @param {Awaited<ReturnType<typeof resolvePlaceContext>>} place
 */
export function computeImpactFromTrees(treeMeta, place) {
  let totalSize = 0
  for (let i = 0; i < treeMeta.length; i++) {
    totalSize += treeMeta[i].sizeScale
  }

  const tempDrop = diminishingReturns(totalSize, place.tempPerSize, 2.1)
  const co2Kg = diminishingReturns(totalSize, place.co2PerSize, 38)
  const airDrop = diminishingReturns(totalSize, place.airDropPerSize, 38)
  const airEnd = Math.max(28, Math.round(place.airStart - airDrop))

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
      statusMsg.style.color = '#c4ff00'
    }
    if (statusDot) {
      statusDot.style.background = '#c4ff00'
      statusDot.style.boxShadow = '0 0 10px #c4ff00'
    }

    // Animate for ~6s so it tracks the slower grow window (dashboard ~2.2s → ~8.2s)
    await animateLiveStats(impact, 6000, { tempVal, co2Val, aqiVal })

    // Recompute from the (possibly still-growing) treeMeta array — if extra
    // trees were tapped down while the numbers above were ticking, the lock
    // -in below picks them up instead of freezing on the ~2.2s snapshot.
    const finalImpact = computeImpactFromTrees(treeMeta, place)

    // —— Beat 2: lock the final readout ——
    if (statusMsg) {
      statusMsg.textContent = finalImpact.hasGps
        ? 'Impact verified · local zone'
        : 'Impact verified'
      statusMsg.style.color = '#c4ff00'
    }
    if (statusDot) {
      statusDot.style.background = '#c4ff00'
      statusDot.style.boxShadow = '0 0 10px #c4ff00'
    }

    if (tempVal) {
      tempVal.innerHTML =
        `${finalImpact.baselineTemp.toFixed(1)}°C <span style="font-size:14px">→</span> ${finalImpact.finalTemp.toFixed(1)}°C`
      tempVal.classList.remove('warning')
      tempVal.classList.add('drop')
    }
    if (co2Val) {
      co2Val.textContent = `${finalImpact.co2Kg.toFixed(1)} kg`
      co2Val.classList.remove('warning')
      co2Val.classList.add('drop')
    }
    if (aqiVal) {
      aqiVal.innerHTML =
        `<span style="opacity:0.55;font-size:11px">${finalImpact.airStart} →</span> ${finalImpact.airEnd} · CLEARER`
      aqiVal.classList.remove('warning')
      aqiVal.classList.add('drop')
    }
  }, 2200)

}

/**
 * Bumps the already-locked dashboard numbers up once extra trees (planted
 * from a second/third/etc. tap) finish growing. Safe to call any number of
 * times — it only rewrites text, never restarts the reveal animation, and
 * it no-ops if the initial reveal hasn't locked its numbers in yet (so it
 * can never race Beat 2 above).
 * @param {{ sizeScale: number }[]} allTreeMeta running total across every planting
 */
export async function refreshImpactDisplay(allTreeMeta) {
  const tempVal = document.getElementById('temp-val')
  const co2Val = document.getElementById('co2-val')
  const aqiVal = document.getElementById('aqi-val')

  // Beat 2 adds the 'drop' class once its numbers are locked — that's our
  // signal it's safe to overwrite them without fighting the tween above.
  if (!tempVal || !tempVal.classList.contains('drop')) return

  const place = await resolvePlaceContext()
  const impact = computeImpactFromTrees(allTreeMeta, place)

  tempVal.innerHTML =
    `${impact.baselineTemp.toFixed(1)}°C <span style="font-size:14px">→</span> ${impact.finalTemp.toFixed(1)}°C`
  if (co2Val) co2Val.textContent = `${impact.co2Kg.toFixed(1)} kg`
  if (aqiVal) {
    aqiVal.innerHTML =
      `<span style="opacity:0.55;font-size:11px">${impact.airStart} →</span> ${impact.airEnd} · CLEARER`
  }
}
