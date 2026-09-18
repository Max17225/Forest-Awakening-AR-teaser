/**
 * tree.js — Procedural forest meshes (grow once, then FREEZE)
 *
 * Malaysia species silhouettes (must read apart at thumbnail size):
 *   spire  — Casuarina / Rhu: tall needle cones, deep blue-green
 *   fan    — Angsana: wide flat umbrella crown, mid forest green
 *   canopy — Kelat jambu: tall dense oval crown, bright emerald
 *   willow — Penaga lilin: columnar upright crown, dark glossy green
 *   under  — hedge shrubs: low olive mound (createUndergrowth)
 *
 * Height: real-tree scale outdoors (~4-6m for a full-size canopy tree after
 * TREE_VISUAL_SCALE) — tilt up a bit to see crowns, not skyscraper-tall.
 *
 * Anti-jitter (phone held still after growth):
 *   - group.position is set ONCE at plant time and never written again
 *   - no canopy sway / rotation in update()
 *   - fireflies are STATIC (no orbit) — motion looked like model drift
 *   - trunk uses easeOutCubic (no elastic overshoot wobble)
 *   - canopy pulse is a ONE-SHOT brighten, not an infinite flicker loop
 *   - update() is a no-op after mature so onUpdate cannot nudge meshes
 *   - hardFreeze() keeps the TRUNK's castShadow on (that's the visible
 *     grounded-shadow cue) and only drops shadows from leaf blobs
 *
 * Perf (many trees planted over multiple taps):
 *   - no per-tree PointLight — every light in the scene gets looped over
 *     in every material's shader each frame, so this was pure overhead
 *     for a light that was always at intensity 0 anyway
 *
 * World placement / SLAM floor raycast lives in scene.js.
 */

import * as THREE from 'three'

const trunkMat = new THREE.MeshStandardMaterial({
  color: 0x3d2817,
  roughness: 0.9,
  metalness: 0.05,
})

const trunkMatDark = new THREE.MeshStandardMaterial({
  color: 0x2a1c12,
  roughness: 0.95,
  metalness: 0.04,
})

/** Rhu — deep blue-green needles */
const leafMatRhu = new THREE.MeshStandardMaterial({
  color: 0x1f6b5a,
  emissive: 0x0a3328,
  emissiveIntensity: 0.45,
  roughness: 0.55,
  transparent: true,
  opacity: 0.94,
})

/** Angsana — mid forest green, broad shade */
const leafMatAngsana = new THREE.MeshStandardMaterial({
  color: 0x3d9e4a,
  emissive: 0x145022,
  emissiveIntensity: 0.42,
  roughness: 0.5,
  transparent: true,
  opacity: 0.92,
})

/** Kelat jambu — bright emerald canopy */
const leafMatKelat = new THREE.MeshStandardMaterial({
  color: 0x5fd65a,
  emissive: 0x1a5520,
  emissiveIntensity: 0.5,
  roughness: 0.42,
  transparent: true,
  opacity: 0.92,
})

/** Penaga lilin — dark glossy columnar green */
const leafMatPenaga = new THREE.MeshStandardMaterial({
  color: 0x145c38,
  emissive: 0x083020,
  emissiveIntensity: 0.4,
  roughness: 0.35,
  transparent: true,
  opacity: 0.93,
})

/** Undergrowth / hedges — muted olive */
const leafMatShrub = new THREE.MeshStandardMaterial({
  color: 0x6b8f3a,
  emissive: 0x2a3a12,
  emissiveIntensity: 0.35,
  roughness: 0.65,
  transparent: true,
  opacity: 0.95,
})

const saplingLeafMat = new THREE.MeshStandardMaterial({
  color: 0x7dff66,
  emissive: 0x224411,
  emissiveIntensity: 0.35,
  roughness: 0.5,
})

const fireflyMat = new THREE.MeshBasicMaterial({ color: 0xffea00 })

const LEAF_MATERIALS = [
  leafMatRhu,
  leafMatAngsana,
  leafMatKelat,
  leafMatPenaga,
  leafMatShrub,
]

/** Scientific names + trait estimates for the species compare panel */
export const SPECIES_INFO = {
  spire: {
    id: 'spire',
    localName: 'Rhu',
    scientific: 'Casuarina equisetifolia',
    /** Modeled mature annual CO₂ uptake (kg/year) — educational estimate */
    co2KgYear: 12,
    traits: {
      leafSurface: 70,
      waxySurfaces: 55,
      hairyTextures: 40,
      leafDensity: 88,
    },
  },
  fan: {
    id: 'fan',
    localName: 'Angsana',
    scientific: 'Pterocarpus indicus',
    co2KgYear: 20,
    traits: {
      leafSurface: 92,
      waxySurfaces: 72,
      hairyTextures: 58,
      leafDensity: 76,
    },
  },
  canopy: {
    id: 'canopy',
    localName: 'Kelat jambu',
    scientific: 'Syzygium grande',
    co2KgYear: 16,
    traits: {
      leafSurface: 86,
      waxySurfaces: 82,
      hairyTextures: 52,
      leafDensity: 84,
    },
  },
  willow: {
    id: 'willow',
    localName: 'Penaga lilin',
    scientific: 'Mesua ferrea',
    co2KgYear: 14,
    traits: {
      leafSurface: 78,
      waxySurfaces: 68,
      hairyTextures: 48,
      leafDensity: 80,
    },
  },
  under: {
    id: 'under',
    localName: 'Teh-tehan',
    scientific: 'Acalypha siamensis',
    co2KgYear: 3,
    traits: {
      leafSurface: 48,
      waxySurfaces: 60,
      hairyTextures: 62,
      leafDensity: 70,
    },
  },
}

export const SPECIES_ORDER = ['spire', 'fan', 'canopy', 'willow', 'under']

export const TRAIT_LABELS = [
  { key: 'leafSurface', label: 'Leaf surface area' },
  { key: 'waxySurfaces', label: 'Waxy surfaces' },
  { key: 'hairyTextures', label: 'Hairy textures' },
  { key: 'leafDensity', label: 'Leaf density' },
]

/**
 * Uniform bump applied on top of each tree's sizeScale so groves read as
 * real trees outdoors (against real buildings/people) instead of looking
 * like tabletop miniatures. Applied at the group level, so every child
 * (trunk, canopy, leaves, fireflies) scales together — proportions from
 * each blueprint below are untouched. Kept separate from `sizeScale` itself
 * so the HUD impact math (which reads sizeScale, not the rendered size)
 * doesn't get thrown off by this.
 */
const TREE_VISUAL_SCALE = 1.7
const UNDERGROWTH_VISUAL_SCALE = 1.15

export const TREE_TYPES = ['canopy', 'spire', 'willow', 'fan']

/**
 * Per-type geometry — silhouettes deliberately diverge for species ID.
 * Trunk heights stay moderate (~2.2–3.4m before sizeScale).
 */
function getTypeBlueprint(type) {
  switch (type) {
    // Rhu — tall, skinny, layered needle cones
    case 'spire':
      return {
        trunkHeight: 3.0 + Math.random() * 0.45,
        trunkTop: 0.035,
        trunkBot: 0.1,
        leafMat: leafMatRhu,
        glowColor: 0x1f6b5a,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const layers = 7
          for (let i = 0; i < layers; i++) {
            const t = i / (layers - 1)
            const radius = 0.38 - t * 0.28
            const cone = new THREE.Mesh(
              new THREE.ConeGeometry(Math.max(0.08, radius), 0.55 + (1 - t) * 0.22, 6),
              leafMat
            )
            cone.position.y = 0.08 + i * 0.42
            cone.scale.setScalar(0.01)
            cone.castShadow = true
            cone.userData.targetScale = 1
            canopy.add(cone)
            leaves.push(cone)
          }
          canopy.position.y = trunkHeight * 0.28
          return leaves
        },
      }

    // Penaga lilin — columnar upright oval (candle form), not droopy
    case 'willow':
      return {
        trunkHeight: 2.65 + Math.random() * 0.4,
        trunkTop: 0.05,
        trunkBot: 0.13,
        leafMat: leafMatPenaga,
        glowColor: 0x145c38,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const column = [
            { x: 0, y: 0.55, z: 0, s: 0.95, geo: 0.42 },
            { x: 0, y: 1.05, z: 0, s: 0.88, geo: 0.38 },
            { x: 0, y: 1.5, z: 0, s: 0.72, geo: 0.32 },
            { x: -0.22, y: 0.7, z: 0.1, s: 0.55, geo: 0.28 },
            { x: 0.22, y: 0.85, z: -0.08, s: 0.55, geo: 0.28 },
            { x: 0.08, y: 1.25, z: 0.18, s: 0.48, geo: 0.24 },
          ]
          column.forEach((pos) => {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry(pos.geo, 1),
              leafMat
            )
            leaf.position.set(pos.x, pos.y, pos.z)
            leaf.scale.set(0.01, 0.01, 0.01)
            leaf.userData.targetScale = pos.s
            leaf.userData.targetScaleY = pos.s * 1.35
            leaf.castShadow = true
            canopy.add(leaf)
            leaves.push(leaf)
          })
          canopy.position.y = trunkHeight * 0.55
          return leaves
        },
      }

    // Angsana — short trunk + compact umbrella (not overly spread)
    case 'fan':
      return {
        trunkHeight: 2.15 + Math.random() * 0.35,
        trunkTop: 0.048,
        trunkBot: 0.14,
        leafMat: leafMatAngsana,
        glowColor: 0x3d9e4a,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const ring = [
            { x: 0, y: 0.08, z: 0, s: 1.0, geo: 0.46 },
            { x: -0.52, y: 0.04, z: 0.1, s: 0.78, geo: 0.36 },
            { x: 0.52, y: 0.04, z: -0.08, s: 0.8, geo: 0.36 },
            { x: 0.1, y: 0.02, z: 0.52, s: 0.76, geo: 0.34 },
            { x: -0.12, y: 0.02, z: -0.52, s: 0.76, geo: 0.34 },
            { x: 0.38, y: 0, z: 0.36, s: 0.58, geo: 0.28 },
            { x: -0.38, y: 0, z: -0.34, s: 0.58, geo: 0.28 },
            { x: 0.36, y: 0, z: -0.32, s: 0.55, geo: 0.26 },
            { x: -0.34, y: 0, z: 0.34, s: 0.55, geo: 0.26 },
          ]
          ring.forEach((pos) => {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry(pos.geo, 1),
              leafMat
            )
            leaf.position.set(pos.x, pos.y, pos.z)
            leaf.scale.setScalar(0.01)
            leaf.castShadow = true
            leaf.userData.targetScale = pos.s
            leaf.userData.targetScaleY = pos.s * 0.62
            canopy.add(leaf)
            leaves.push(leaf)
          })
          canopy.position.y = trunkHeight * 0.98
          return leaves
        },
      }

    // Kelat jambu — tall dense round/oval crown
    case 'canopy':
    default:
      return {
        trunkHeight: 2.4 + Math.random() * 0.45,
        trunkTop: 0.06,
        trunkBot: 0.145,
        leafMat: leafMatKelat,
        glowColor: 0x5fd65a,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const blobs = [
            { x: 0, y: 0.55, z: 0, s: 1.15, geo: 0.55 },
            { x: -0.4, y: 0.35, z: 0.25, s: 0.78, geo: 0.4 },
            { x: 0.42, y: 0.32, z: -0.22, s: 0.82, geo: 0.42 },
            { x: 0.1, y: 0.2, z: 0.42, s: 0.7, geo: 0.36 },
            { x: -0.2, y: 0.18, z: -0.4, s: 0.72, geo: 0.36 },
            { x: 0.28, y: 0.85, z: 0.12, s: 0.62, geo: 0.32 },
            { x: -0.25, y: 0.82, z: -0.1, s: 0.6, geo: 0.3 },
            { x: 0, y: 1.05, z: 0, s: 0.55, geo: 0.28 },
          ]
          blobs.forEach((pos) => {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry(pos.geo, 1),
              leafMat
            )
            leaf.position.set(pos.x, pos.y, pos.z)
            leaf.scale.setScalar(0.01)
            leaf.castShadow = true
            leaf.userData.targetScale = pos.s
            canopy.add(leaf)
            leaves.push(leaf)
          })
          canopy.position.y = trunkHeight * 0.92
          return leaves
        },
      }
  }
}

/**
 * Plant one tree at a FIXED world point (x, y, z). After growth finishes,
 * nothing in this object moves world-space transforms anymore.
 */
export function createGrowingTree(scene, x, y, z, options = {}) {
  const sizeScale = options.sizeScale ?? 1.1
  const startDelay = options.startDelay ?? 0
  const instantMature = Boolean(options.instantMature)
  const treeType =
    options.treeType ||
    TREE_TYPES[Math.floor(Math.random() * TREE_TYPES.length)]

  const blueprint = getTypeBlueprint(treeType)
  const trunkHeight = blueprint.trunkHeight
  const leafMat = blueprint.leafMat

  // Frozen world anchor — do not write group.position after this
  const group = new THREE.Group()
  group.position.set(x, y, z)
  group.rotation.y =
    typeof options.rotationY === 'number'
      ? options.rotationY
      : Math.random() * Math.PI * 2
  group.scale.setScalar(sizeScale * TREE_VISUAL_SCALE)
  group.userData.treeType = treeType
  scene.add(group)

  let frozen = false

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.028, 0.28, 6),
    trunkMat
  )
  stem.castShadow = true
  stem.position.y = 0.14
  stem.scale.set(1, 0.01, 1)
  group.add(stem)

  const firstLeaves = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.09, 0),
    saplingLeafMat
  )
  firstLeaves.position.y = 0.28
  firstLeaves.scale.setScalar(0.01)
  firstLeaves.castShadow = true
  group.add(firstLeaves)

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(
      blueprint.trunkTop,
      blueprint.trunkBot,
      trunkHeight,
      8
    ),
    treeType === 'willow' || treeType === 'spire' ? trunkMatDark : trunkMat
  )
  trunk.castShadow = true
  trunk.position.y = 0
  trunk.scale.set(1, 0.01, 1)
  trunk.visible = false
  group.add(trunk)

  const canopy = new THREE.Group()
  canopy.visible = false
  group.add(canopy)
  const leaves = blueprint.buildCanopy(canopy, trunkHeight, leafMat)

  // No per-tree PointLight — it used to sit at intensity 0 doing nothing
  // visually, but every added light still gets looped over in the lighting
  // shader for every material in the scene, so with dozens of trees planted
  // it was pure per-frame overhead. Removed entirely for perf.

  const fireflies = []
  const animate = typeof window !== 'undefined' && window.anime ? window.anime : null

  /** Snap finals, detach anime, freeze matrices — stops post-grow “shake when idle” */
  const hardFreeze = () => {
    if (animate) {
      animate.remove(stem.scale)
      animate.remove(firstLeaves.scale)
      animate.remove(trunk.scale)
      animate.remove(trunk.position)
      leaves.forEach((leaf) => animate.remove(leaf.scale))
    }

    stem.visible = false
    firstLeaves.visible = false
    trunk.visible = true
    trunk.scale.set(1, 1, 1)
    trunk.position.y = trunkHeight / 2
    canopy.visible = true
    leaves.forEach((leaf) => {
      const sx = leaf.userData.targetScale ?? 1
      const sy = leaf.userData.targetScaleY ?? sx
      leaf.scale.set(sx, sy, sx)
    })

    // Keep the trunk's shadow — that's the visible "tree is grounded" cue.
    // Only drop shadows from the leaf blobs (cheaper, and losing leaf
    // shadows is invisible next to the trunk's shadow blob).
    trunk.receiveShadow = false
    leaves.forEach((leaf) => {
      leaf.castShadow = false
      leaf.receiveShadow = false
    })

    // Bake matrices BEFORE disabling autoUpdate (Three skips updateMatrix when autoUpdate is false)
    group.traverse((obj) => {
      obj.updateMatrix()
      obj.matrixAutoUpdate = false
    })
    group.updateMatrixWorld(true)
    frozen = true
  }

  const beginGrowth = () => {
    // PHASE 1 — Sprout (~0–1.6s)
    if (animate) {
      animate({
        targets: stem.scale,
        y: 1,
        duration: 1400,
        easing: 'easeOutCubic',
      })
      animate({
        targets: firstLeaves.scale,
        x: 1,
        y: 1,
        z: 1,
        duration: 1500,
        delay: 280,
        easing: 'easeOutCubic',
      })
    } else {
      stem.scale.y = 1
      firstLeaves.scale.setScalar(1)
    }

    // PHASE 2 — Trunk rise (~1.6–4.0s)
    window.setTimeout(() => {
      trunk.visible = true
      if (animate) {
        animate({
          targets: [stem.scale, firstLeaves.scale],
          x: 0.01,
          y: 0.01,
          z: 0.01,
          duration: 520,
          easing: 'easeInQuad',
          complete: () => {
            stem.visible = false
            firstLeaves.visible = false
          },
        })
        animate({
          targets: trunk.scale,
          y: 1,
          duration: 2400,
          easing: 'easeOutCubic',
        })
        animate({
          targets: trunk.position,
          y: trunkHeight / 2,
          duration: 2400,
          easing: 'easeOutCubic',
        })
      } else {
        stem.visible = false
        firstLeaves.visible = false
        trunk.scale.y = 1
        trunk.position.y = trunkHeight / 2
      }
    }, 1600)

    // PHASE 3 — Canopy (~4.0–7.2s)
    window.setTimeout(() => {
      canopy.visible = true
      leaves.forEach((leaf, i) => {
        const sx = leaf.userData.targetScale ?? 1
        const sy = leaf.userData.targetScaleY ?? sx
        if (animate) {
          animate({
            targets: leaf.scale,
            x: sx,
            y: sy,
            z: sx,
            duration: 2400,
            delay: i * 180,
            easing: 'easeOutCubic',
          })
        } else {
          leaf.scale.set(sx, sy, sx)
        }
      })
    }, 4000)

    // PHASE 4 — Settle + hard freeze (no leftover tweens / lights / shadows)
    window.setTimeout(() => {
      spawnStaticFireflies(group, fireflies, trunkHeight)
      hardFreeze()

      if (typeof options.onMature === 'function') {
        options.onMature()
      }
    }, 7500)
  }

  if (instantMature) {
    if (!options.skipFireflies) {
      spawnStaticFireflies(group, fireflies, trunkHeight)
    }
    hardFreeze()
    if (typeof options.onMature === 'function') options.onMature()
  } else if (startDelay > 0) {
    window.setTimeout(beginGrowth, startDelay)
  } else {
    beginGrowth()
  }

  return {
    group,
    fireflies,
    treeType,
    /**
     * Called every XR frame from scene.js.
     * After mature: intentional no-op so held-still phones don't show dancing meshes.
     */
    update() {
      if (frozen) return
      // During growth we also avoid per-frame mesh writes — anime owns scale/position
    },
  }
}

/**
 * Short bush / sapling filler for forest-floor density.
 * World position frozen; update() is always a no-op.
 */
export function createUndergrowth(scene, x, y, z, options = {}) {
  const sizeScale = options.sizeScale ?? 0.7
  const startDelay = options.startDelay ?? 0
  const instantMature = Boolean(options.instantMature)

  const group = new THREE.Group()
  group.position.set(x, y, z)
  group.rotation.y =
    typeof options.rotationY === 'number'
      ? options.rotationY
      : Math.random() * Math.PI * 2
  group.scale.setScalar(sizeScale * UNDERGROWTH_VISUAL_SCALE)
  scene.add(group)

  const stemH = 0.32 + Math.random() * 0.22
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.035, stemH, 5),
    trunkMat
  )
  stem.position.y = stemH / 2
  stem.scale.set(1, 0.01, 1)
  stem.castShadow = true
  group.add(stem)

  const blob = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.22 + Math.random() * 0.12, 0),
    leafMatShrub
  )
  blob.position.y = stemH + 0.12
  blob.scale.setScalar(0.01)
  blob.castShadow = true
  group.add(blob)

  // Extra side mounds so hedges read as a low multi-stem clump
  const sideA = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.14 + Math.random() * 0.08, 0),
    leafMatShrub
  )
  sideA.position.set(-0.18, stemH + 0.02, 0.08)
  sideA.scale.setScalar(0.01)
  group.add(sideA)

  const sideB = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12 + Math.random() * 0.08, 0),
    leafMatShrub
  )
  sideB.position.set(0.16, stemH, -0.1)
  sideB.scale.setScalar(0.01)
  group.add(sideB)

  const animate = typeof window !== 'undefined' && window.anime ? window.anime : null

  const hardFreezeUnder = () => {
    if (animate) {
      animate.remove(stem.scale)
      animate.remove(blob.scale)
      animate.remove(sideA.scale)
      animate.remove(sideB.scale)
    }
    stem.scale.set(1, 1, 1)
    blob.scale.setScalar(1)
    sideA.scale.setScalar(1)
    sideB.scale.setScalar(1)
    // Keep the stem's shadow; drop foliage shadows
    ;[blob, sideA, sideB].forEach((m) => {
      m.castShadow = false
      m.receiveShadow = false
    })
    stem.receiveShadow = false
    group.traverse((obj) => {
      obj.updateMatrix()
      obj.matrixAutoUpdate = false
    })
    group.updateMatrixWorld(true)
  }

  const grow = () => {
    if (animate) {
      animate({
        targets: stem.scale,
        y: 1,
        duration: 1200,
        easing: 'easeOutCubic',
      })
      animate({
        targets: [blob.scale, sideA.scale, sideB.scale],
        x: 1,
        y: 1,
        z: 1,
        duration: 1500,
        delay: 400,
        easing: 'easeOutCubic',
        complete: hardFreezeUnder,
      })
    } else {
      stem.scale.y = 1
      blob.scale.setScalar(1)
      sideA.scale.setScalar(1)
      sideB.scale.setScalar(1)
      hardFreezeUnder()
    }
  }

  if (instantMature) {
    hardFreezeUnder()
  } else if (startDelay > 0) {
    window.setTimeout(grow, startDelay)
  } else {
    grow()
  }

  return {
    group,
    fireflies: [],
    treeType: 'under',
    update() {},
  }
}

/** Place fireflies once; they never move afterward */
function spawnStaticFireflies(treeGroup, outList, trunkHeight) {
  const geo = new THREE.SphereGeometry(0.032, 8, 8)
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(geo, fireflyMat)
    const angle = Math.random() * Math.PI * 2
    const radius = 0.45 + Math.random() * 0.75
    const height = trunkHeight * 0.55 + Math.random() * trunkHeight * 0.35
    mesh.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius)
    treeGroup.add(mesh)
    outList.push({ mesh })
  }
}

/**
 * Soft one-shot brighten when the forest awakens.
 * Direct material write only — no anime loop (that read as shimmer/shake when idle).
 */
export function pulseForestCanopy() {
  for (let i = 0; i < LEAF_MATERIALS.length; i++) {
    LEAF_MATERIALS[i].emissiveIntensity = 1.2
  }
}
