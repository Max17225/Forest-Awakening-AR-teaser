/**
 * aqi.js — US AQI bands (the standard EPA scale).
 *
 * `swatch` = reference colour in More info.
 * `text` = lifted hue for numbers on the dark HUD / splash.
 * `splashLine` = Start AR description copy for that band.
 */

export const AQI_BANDS = [
  {
    max: 50,
    label: 'Good',
    range: '0 – 50',
    swatch: '#6cc24a',
    text: [126, 217, 87],
    splashLine: 'Good.',
  },
  {
    max: 100,
    label: 'Moderate',
    range: '51 – 100',
    swatch: '#ffe94f',
    text: [255, 233, 79],
    splashLine: 'Moderate.',
  },
  {
    max: 150,
    label: 'Unhealthy for Sensitive Groups',
    range: '101 – 150',
    swatch: '#ef8b3f',
    text: [255, 159, 69],
    splashLine: 'Unhealthy for sensitive groups.',
  },
  {
    max: 200,
    label: 'Unhealthy',
    range: '151 – 200',
    swatch: '#e8503a',
    text: [255, 92, 71],
    splashLine: 'Unhealthy.',
  },
  {
    max: 300,
    label: 'Very Unhealthy',
    range: '201 – 300',
    swatch: '#7d5295',
    text: [181, 127, 216],
    splashLine: 'Very unhealthy.',
  },
  {
    max: Infinity,
    label: 'Hazardous',
    range: '301 – 500',
    swatch: '#7a2436',
    text: [224, 85, 107],
    splashLine: 'Hazardous.',
  },
]

/** @param {number} aqi */
export function aqiBand(aqi) {
  const v = Number(aqi)
  if (!Number.isFinite(v)) return AQI_BANDS[0]
  return AQI_BANDS.find((b) => v <= b.max) || AQI_BANDS[AQI_BANDS.length - 1]
}

/**
 * Short place name for splash + dashboard — the area the AQI/temp
 * reading was taken for (first segment of the Nominatim label).
 * @param {string | null | undefined} placeLabel
 */
export function readingPlaceName(placeLabel) {
  if (!placeLabel) return null
  const part = String(placeLabel).split(',')[0].trim()
  return part || null
}
