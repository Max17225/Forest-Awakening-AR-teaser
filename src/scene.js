/**
 * scene.js — Tap once → dense forest on the SLAM floor → HUD sequence
 *
 * How anchoring works (official 8th Wall placeground style):
 *   - Invisible floor plane at y = 0
 *   - Finger tap → raycast that plane → plant at (x, 0, z)
 *   - Tree groups NEVER change world position afterward
 *   - XR8 SLAM moves the camera around those fixed points
 *
 * Anti-jitter checklist (held still after plant):
 *   ✓ GPS / Open-Meteo prefetched in app.js — not during AR
 *   ✓ No XR8.XrController.recenter() on two-finger grip
 *   ✓ No hitTest feature-points (unstable y)
 *   ✓ tree.update() is a no-op after mature (see tree.js)
 *   ✓ No per-frame canopy sway / firefly orbits
 *
 * Note: tiny SLAM sensor noise from the engine itself can still exist in
 * low-texture rooms — that is XR8, not our meshes moving. Our code no
 * longer animates mature tree transforms while idle.
 */

import * as THREE from 'three'
import {
  createGrowingTree,
  createUndergrowth,
  pulseForestCanopy,
  TREE_TYPES,
} from './tree.js'
import { playAwakeningSequence } from './sequence.js'

/** Tall canopy trees in the stand */
const CANOPY_COUNT = 18
/** Low bushes between trunks */
const UNDER_COUNT = 14

export function initForestPipelineModule() {
  let surface = null
  const trees = []
  let hasPlanted = false

  const raycaster = new THREE.Raycaster()
  const tapPosition = new THREE.Vector2()

  const initXrScene = ({ scene, camera, renderer }) => {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(1, 4.3, 2.5)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0x404040, 5))

    // Official placeground surface — tap target + shadow catcher at y = 0
    surface = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100, 1, 1),
      new THREE.ShadowMaterial({ opacity: 0.5 })
    )
    surface.rotateX(-Math.PI / 2)
    surface.position.set(0, 0, 0)
    surface.receiveShadow = true
    scene.add(surface)

    // Must start above y = 0 for SLAM (official sample uses y = 3)
    camera.position.set(0, 3, 0)
  }

  /**
   * Dense stand: center tree + inner ring + outer ring + undergrowth.
   * Each canopy tree's sizeScale feeds the HUD impact math.
   */
  const plantGrove = (scene, centerX, centerZ) => {
    const instruction = document.getElementById('instruction')
    if (instruction) instruction.classList.add('is-hidden')

    /** @type {{ sizeScale: number }[]} */
    const treeMeta = []

    // Center
    {
      const sizeScale = 1.2
      treeMeta.push({ sizeScale })
      trees.push(
        createGrowingTree(scene, centerX, 0, centerZ, {
          sizeScale,
          startDelay: 0,
          treeType: 'canopy',
          onMature: () => pulseForestCanopy(),
        })
      )
    }

    // Inner ring
    const innerCount = 7
    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * Math.PI * 2 + Math.random() * 0.25
      const dist = 0.55 + Math.random() * 0.45
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.88 + Math.random() * 0.28
      treeMeta.push({ sizeScale })
      trees.push(
        createGrowingTree(scene, x, 0, z, {
          sizeScale,
          startDelay: 80 + i * 90,
          treeType: TREE_TYPES[i % TREE_TYPES.length],
        })
      )
    }

    // Outer ring
    const outerCount = CANOPY_COUNT - 1 - innerCount
    for (let i = 0; i < outerCount; i++) {
      const angle = (i / outerCount) * Math.PI * 2 + Math.random() * 0.3
      const dist = 1.15 + Math.random() * 0.85
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.78 + Math.random() * 0.32
      treeMeta.push({ sizeScale })
      trees.push(
        createGrowingTree(scene, x, 0, z, {
          sizeScale,
          startDelay: 200 + i * 70,
          treeType: TREE_TYPES[(i + 1) % TREE_TYPES.length],
        })
      )
    }

    // Undergrowth
    for (let i = 0; i < UNDER_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = 0.35 + Math.random() * 1.7
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      trees.push(
        createUndergrowth(scene, x, 0, z, {
          startDelay: 400 + i * 60,
          sizeScale: 0.55 + Math.random() * 0.45,
        })
      )
    }

    playAwakeningSequence(treeMeta)
  }

  const placeObjectTouchHandler = (e) => {
    // Single finger only — two-finger recenter was disabled (caused re-anchor jitter)
    if (e.touches.length !== 1 || hasPlanted || !surface) return

    const { scene, camera } = XR8.Threejs.xrScene()

    tapPosition.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1
    tapPosition.y = -(e.touches[0].clientY / window.innerHeight) * 2 + 1

    raycaster.setFromCamera(tapPosition, camera)
    const intersects = raycaster.intersectObject(surface)

    if (intersects.length === 1 && intersects[0].object === surface) {
      hasPlanted = true
      const { x, z } = intersects[0].point
      plantGrove(scene, x, z)
    }
  }

  return {
    name: 'forest-awakening-grove',

    onStart: ({ canvas }) => {
      const { scene, camera, renderer } = XR8.Threejs.xrScene()
      initXrScene({ scene, camera, renderer })

      canvas.addEventListener('touchstart', placeObjectTouchHandler, true)
      canvas.addEventListener(
        'touchmove',
        (event) => {
          event.preventDefault()
        },
        { passive: false }
      )

      // Sync SLAM origin to this Three.js camera pose (once at start)
      XR8.XrController.updateCameraProjectionMatrix({
        origin: camera.position,
        facing: camera.quaternion,
      })
    },

    onUpdate: () => {
      // Safe: mature trees' update() is a no-op (see tree.js anti-jitter notes)
      for (let i = 0; i < trees.length; i++) {
        trees[i].update()
      }
    },
  }
}
