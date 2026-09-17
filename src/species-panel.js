/**
 * Species compare panel — left: live 3D model, right: trait bars.
 * Scientific names only. Trait values are educational estimates.
 */

import * as THREE from 'three'
import {
  createGrowingTree,
  createUndergrowth,
  SPECIES_INFO,
  SPECIES_ORDER,
  TRAIT_LABELS,
} from './tree.js'

let panelEl = null
let titleEl = null
let barsEl = null
let tabsEl = null
let canvas = null
let renderer = null
let scene = null
let camera = null
let currentGroup = null
let currentType = SPECIES_ORDER[0]
let rafId = 0
let spinning = false

function ensureDom() {
  panelEl = document.getElementById('species-panel')
  titleEl = document.getElementById('species-panel-title')
  barsEl = document.getElementById('species-trait-bars')
  tabsEl = document.getElementById('species-tabs')
  canvas = document.getElementById('species-preview-canvas')
  return Boolean(panelEl && titleEl && barsEl && tabsEl && canvas)
}

function buildTabs() {
  if (!tabsEl) return
  tabsEl.innerHTML = ''
  SPECIES_ORDER.forEach((id) => {
    const info = SPECIES_INFO[id]
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'species-tab'
    btn.dataset.species = id
    btn.textContent = info.scientific
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      selectSpecies(id)
    })
    tabsEl.appendChild(btn)
  })
}

function renderBars(typeId) {
  const info = SPECIES_INFO[typeId]
  if (!barsEl || !info) return
  barsEl.innerHTML = ''
  TRAIT_LABELS.forEach(({ key, label }) => {
    const value = info.traits[key] ?? 0
    const row = document.createElement('div')
    row.className = 'trait-row'
    row.innerHTML = `
      <div class="trait-row-top">
        <span class="trait-label">${label}</span>
        <span class="trait-value">${value}%</span>
      </div>
      <div class="trait-track" role="meter" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100" aria-label="${label}">
        <div class="trait-fill" style="width:${value}%"></div>
      </div>
    `
    barsEl.appendChild(row)
  })
}

function clearPreviewTree() {
  if (!scene || !currentGroup) return
  scene.remove(currentGroup)
  currentGroup.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
  })
  currentGroup = null
}

function mountPreviewTree(typeId) {
  if (!scene) return
  clearPreviewTree()

  const isUnder = typeId === 'under'
  const created = isUnder
    ? createUndergrowth(scene, 0, 0, 0, {
        sizeScale: 1.6,
        instantMature: true,
        rotationY: 0.35,
      })
    : createGrowingTree(scene, 0, 0, 0, {
        sizeScale: typeId === 'fan' ? 0.95 : 1.05,
        treeType: typeId,
        instantMature: true,
        skipFireflies: true,
        rotationY: 0.55,
      })

  currentGroup = created.group
  // Panel trees should keep matrixAutoUpdate so we can spin them a little
  currentGroup.traverse((obj) => {
    obj.matrixAutoUpdate = true
  })
}

function initPreviewRenderer() {
  if (!canvas || renderer) return

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x000000, 0)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 40)
  camera.position.set(0, 3.4, 9.5)
  camera.lookAt(0, 2.2, 0)

  scene.add(new THREE.AmbientLight(0xffffff, 0.65))
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(3, 8, 5)
  scene.add(key)
  scene.add(new THREE.HemisphereLight(0xc8ffd8, 0x1a2a1a, 0.55))
}

function resizePreview() {
  if (!canvas || !renderer || !camera) return
  const w = canvas.clientWidth || 160
  const h = canvas.clientHeight || 200
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
}

function startSpin() {
  if (spinning) return
  spinning = true
  const tick = () => {
    if (!spinning) return
    if (currentGroup) currentGroup.rotation.y += 0.008
    if (renderer && scene && camera) renderer.render(scene, camera)
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function stopSpin() {
  spinning = false
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

export function selectSpecies(typeId) {
  if (!SPECIES_INFO[typeId]) return
  currentType = typeId
  if (titleEl) titleEl.textContent = SPECIES_INFO[typeId].scientific
  renderBars(typeId)
  mountPreviewTree(typeId)
  resizePreview()
  if (renderer && scene && camera) renderer.render(scene, camera)

  if (tabsEl) {
    tabsEl.querySelectorAll('.species-tab').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.species === typeId)
    })
  }
}

export function openSpeciesPanel(typeId = currentType) {
  if (!ensureDom()) return
  initPreviewRenderer()
  buildTabs()
  panelEl.classList.remove('hidden')
  panelEl.setAttribute('aria-hidden', 'false')
  selectSpecies(typeId)
  // Layout then size canvas
  requestAnimationFrame(() => {
    resizePreview()
    if (renderer && scene && camera) renderer.render(scene, camera)
    startSpin()
  })
}

export function closeSpeciesPanel() {
  if (!panelEl) return
  stopSpin()
  clearPreviewTree()
  panelEl.classList.add('hidden')
  panelEl.setAttribute('aria-hidden', 'true')
}

export function showSpeciesInfoButton() {
  const btn = document.getElementById('species-info-btn')
  if (btn) btn.classList.remove('hidden')
}

/** Wire open / close / outside-tap once after DOM is ready */
export function initSpeciesPanel() {
  if (!ensureDom()) return

  const openBtn = document.getElementById('species-info-btn')
  const closeBtn = document.getElementById('species-panel-close')
  const card = panelEl.querySelector('.species-panel-card')

  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      openSpeciesPanel(currentType)
    })
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      closeSpeciesPanel()
    })
  }
  panelEl.addEventListener('click', (e) => {
    if (e.target === panelEl) closeSpeciesPanel()
  })
  if (card) {
    card.addEventListener('click', (e) => e.stopPropagation())
    // Prevent AR plant taps while interacting with the panel
    ;['touchstart', 'touchend', 'pointerdown'].forEach((evt) => {
      card.addEventListener(evt, (e) => e.stopPropagation())
    })
  }

  window.addEventListener('resize', () => {
    if (!panelEl.classList.contains('hidden')) resizePreview()
  })
}
