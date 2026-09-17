/**
 * Offline lineup of Malaysia tree silhouettes (no XR).
 * Uses live createGrowingTree / createUndergrowth (wait ~8s to mature).
 */
import * as THREE from 'three'
import {
  createGrowingTree,
  createUndergrowth,
  TREE_TYPES,
  SPECIES_INFO,
} from './tree.js'

const canvas = document.getElementById('c')
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
renderer.setClearColor(0x0d1410, 1)
renderer.shadowMap.enabled = true

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80)
camera.position.set(0, 5.2, 16.5)
camera.lookAt(0, 2.6, 0)

scene.add(new THREE.AmbientLight(0xffffff, 0.55))
const key = new THREE.DirectionalLight(0xffffff, 1.2)
key.position.set(5, 12, 7)
key.castShadow = true
scene.add(key)
scene.add(new THREE.HemisphereLight(0xb8ffd0, 0x223322, 0.5))

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(22, 48),
  new THREE.MeshStandardMaterial({ color: 0x152018, roughness: 1 })
)
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

const lineup = [
  { type: 'spire' },
  { type: 'fan' },
  { type: 'canopy' },
  { type: 'willow' },
  { type: 'under' },
]

const spacing = 3.6
const startX = -((lineup.length - 1) * spacing) / 2

lineup.forEach((item, i) => {
  const x = startX + i * spacing
  if (item.type === 'under') {
    createUndergrowth(scene, x, 0, 0, { sizeScale: 1.45, startDelay: 0 })
  } else {
    createGrowingTree(scene, x, 0, 0, {
      sizeScale: 1.2,
      startDelay: 0,
      treeType: item.type,
    })
  }
})

function resize() {
  const w = canvas.clientWidth || window.innerWidth
  const h = canvas.clientHeight || window.innerHeight - 110
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

function tick() {
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
tick()

window.__SPECIES_PREVIEW__ = { scene, camera, renderer, TREE_TYPES, SPECIES_INFO }
