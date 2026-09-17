/**
 * scene.js — Tap → spaced Malaysia forest on the SLAM floor → HUD sequence.
 * Every tap after the first plants a smaller extra cluster at the new spot.
 */

import * as THREE from 'three'
import {
  createGrowingTree,
  createUndergrowth,
  pulseForestCanopy,
  TREE_TYPES,
} from './tree.js'
import { playAwakeningSequence, refreshImpactDisplay } from './sequence.js'
import { updatePlantedCounts } from './species-panel.js'

/** Tall canopy trees in the FIRST grove */
const CANOPY_COUNT = 16
/** Low bushes in the FIRST grove */
const UNDER_COUNT = 12

/** Every tap after the first plants a mini-cluster instead of the full grove */
const EXTRA_CANOPY_COUNT = 5
const EXTRA_UNDER_COUNT = 4

/** Wider rings so crowns do not stack on each other */
const INNER_DIST = [1.55, 2.35]
const OUTER_DIST = [2.9, 4.4]
const UNDER_DIST = [1.1, 3.8]
const EXTRA_DIST = [1.5, 3.0]
const EXTRA_UNDER_DIST = [1.0, 2.8]

function ringDist([min, max]) {
  return min + Math.random() * (max - min)
}

export function initForestPipelineModule() {
  let surface = null
  const trees = []
  let plantCount = 0
  /** @type {{ sizeScale: number, treeType: string }[]} */
  const allTreeMeta = []

  const raycaster = new THREE.Raycaster()
  const tapPosition = new THREE.Vector2()

  const syncCounts = () => updatePlantedCounts(allTreeMeta)

  const initXrScene = ({ scene, camera, renderer }) => {
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    const light = new THREE.DirectionalLight(0xffffff, 1)
    light.position.set(1, 4.3, 2.5)
    light.castShadow = true
    light.shadow.mapSize.set(1024, 1024)
    scene.add(light)
    scene.add(new THREE.AmbientLight(0x404040, 5))

    surface = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100, 1, 1),
      new THREE.ShadowMaterial({ opacity: 0.5 })
    )
    surface.rotateX(-Math.PI / 2)
    surface.position.set(0, 0, 0)
    surface.receiveShadow = true
    scene.add(surface)

    camera.position.set(0, 3, 0)
  }

  const scheduleShadowBake = () => {
    window.setTimeout(() => {
      try {
        const { renderer } = XR8.Threejs.xrScene()
        if (renderer?.shadowMap) {
          renderer.shadowMap.needsUpdate = true
          renderer.shadowMap.autoUpdate = false
        }
      } catch (_) {
        /* XR scene may not be ready */
      }
    }, 10000)
  }

  const plantGrove = (scene, centerX, centerZ) => {
    const instruction = document.getElementById('instruction')
    if (instruction) instruction.classList.add('is-hidden')

    // Center
    {
      const sizeScale = 1.15
      const treeType = 'canopy'
      allTreeMeta.push({ sizeScale, treeType })
      trees.push(
        createGrowingTree(scene, centerX, 0, centerZ, {
          sizeScale,
          startDelay: 0,
          treeType,
          onMature: () => pulseForestCanopy(),
        })
      )
    }

    const innerCount = 6
    for (let i = 0; i < innerCount; i++) {
      const angle = (i / innerCount) * Math.PI * 2 + Math.random() * 0.2
      const dist = ringDist(INNER_DIST)
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.85 + Math.random() * 0.25
      const treeType = TREE_TYPES[i % TREE_TYPES.length]
      allTreeMeta.push({ sizeScale, treeType })
      trees.push(
        createGrowingTree(scene, x, 0, z, {
          sizeScale,
          startDelay: 80 + i * 90,
          treeType,
        })
      )
    }

    const outerCount = CANOPY_COUNT - 1 - innerCount
    for (let i = 0; i < outerCount; i++) {
      const angle = (i / outerCount) * Math.PI * 2 + Math.random() * 0.25
      const dist = ringDist(OUTER_DIST)
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.75 + Math.random() * 0.28
      const treeType = TREE_TYPES[(i + 1) % TREE_TYPES.length]
      allTreeMeta.push({ sizeScale, treeType })
      trees.push(
        createGrowingTree(scene, x, 0, z, {
          sizeScale,
          startDelay: 200 + i * 70,
          treeType,
        })
      )
    }

    for (let i = 0; i < UNDER_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = ringDist(UNDER_DIST)
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.55 + Math.random() * 0.4
      allTreeMeta.push({ sizeScale, treeType: 'under' })
      trees.push(
        createUndergrowth(scene, x, 0, z, {
          startDelay: 400 + i * 60,
          sizeScale,
        })
      )
    }

    syncCounts()
    playAwakeningSequence(allTreeMeta)
    scheduleShadowBake()
  }

  const plantExtraCluster = (scene, centerX, centerZ) => {
    for (let i = 0; i < EXTRA_CANOPY_COUNT; i++) {
      const angle =
        (i / EXTRA_CANOPY_COUNT) * Math.PI * 2 + Math.random() * 0.3
      const dist = ringDist(EXTRA_DIST)
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.72 + Math.random() * 0.35
      const treeType = TREE_TYPES[(plantCount + i) % TREE_TYPES.length]
      allTreeMeta.push({ sizeScale, treeType })
      trees.push(
        createGrowingTree(scene, x, 0, z, {
          sizeScale,
          startDelay: i * 90,
          treeType,
          onMature:
            i === EXTRA_CANOPY_COUNT - 1
              ? () => {
                  syncCounts()
                  refreshImpactDisplay(allTreeMeta)
                }
              : undefined,
        })
      )
    }

    for (let i = 0; i < EXTRA_UNDER_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const dist = ringDist(EXTRA_UNDER_DIST)
      const x = centerX + Math.cos(angle) * dist
      const z = centerZ + Math.sin(angle) * dist
      const sizeScale = 0.5 + Math.random() * 0.35
      allTreeMeta.push({ sizeScale, treeType: 'under' })
      trees.push(
        createUndergrowth(scene, x, 0, z, {
          startDelay: 250 + i * 60,
          sizeScale,
        })
      )
    }

    syncCounts()
    scheduleShadowBake()
  }

  const placeObjectTouchHandler = (e) => {
    const speciesPanel = document.getElementById('species-panel')
    if (speciesPanel && !speciesPanel.classList.contains('hidden')) return
    const howto = document.getElementById('howto-modal')
    if (howto && !howto.classList.contains('hidden')) return
    if (!window.__FA_SPLASH_DISMISSED__ || e.touches.length !== 1 || !surface) {
      return
    }
    if (!window.__FA_HOWTO_DONE__) return

    const { scene, camera } = XR8.Threejs.xrScene()

    tapPosition.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1
    tapPosition.y = -(e.touches[0].clientY / window.innerHeight) * 2 + 1

    raycaster.setFromCamera(tapPosition, camera)
    const intersects = raycaster.intersectObject(surface)

    if (intersects.length === 1 && intersects[0].object === surface) {
      const { x, z } = intersects[0].point

      if (plantCount === 0) {
        plantGrove(scene, x, z)
      } else {
        plantExtraCluster(scene, x, z)
      }
      plantCount += 1
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

      XR8.XrController.updateCameraProjectionMatrix({
        origin: camera.position,
        facing: camera.quaternion,
      })
    },

    onUpdate: () => {
      for (let i = 0; i < trees.length; i++) {
        trees[i].update()
      }
    },
  }
}