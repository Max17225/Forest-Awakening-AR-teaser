/**
 * tree.js — Procedural forest meshes (grow once, then FREEZE)
 *
 * Silhouettes mixed in the grove:
 *   canopy — lime cloud blobs
 *   spire  — layered cones (pine)
 *   willow — high trunk + drooping foliage
 *   fan    — umbrella / wide crown
 *   under  — short bushes (createUndergrowth) filling the floor
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

const leafMatLime = new THREE.MeshStandardMaterial({
  color: 0xccff00,
  emissive: 0x445500,
  emissiveIntensity: 0.55,
  roughness: 0.4,
  transparent: true,
  opacity: 0.92,
})

const leafMatTeal = new THREE.MeshStandardMaterial({
  color: 0x66ffaa,
  emissive: 0x114433,
  emissiveIntensity: 0.5,
  roughness: 0.45,
  transparent: true,
  opacity: 0.9,
})

const leafMatGold = new THREE.MeshStandardMaterial({
  color: 0xd4ff4a,
  emissive: 0x556600,
  emissiveIntensity: 0.48,
  roughness: 0.42,
  transparent: true,
  opacity: 0.9,
})

const saplingLeafMat = new THREE.MeshStandardMaterial({
  color: 0xdfff66,
  emissive: 0x334400,
  emissiveIntensity: 0.4,
  roughness: 0.5,
})

const fireflyMat = new THREE.MeshBasicMaterial({ color: 0xffea00 })

const LEAF_MATERIALS = [leafMatLime, leafMatTeal, leafMatGold]

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
 * Per-type geometry. Trunk heights are moderate (~2.3–3.2m before sizeScale)
 * so crowns need a slight look-up without towering over the room.
 */
function getTypeBlueprint(type) {
  switch (type) {
    case 'spire':
      return {
        trunkHeight: 2.55 + Math.random() * 0.55,
        trunkTop: 0.05,
        trunkBot: 0.15,
        leafMat: leafMatTeal,
        glowColor: 0x66ffaa,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const layers = 5
          for (let i = 0; i < layers; i++) {
            const t = i / (layers - 1)
            const radius = 0.5 - t * 0.34
            const cone = new THREE.Mesh(
              new THREE.ConeGeometry(radius, 0.62 + (1 - t) * 0.3, 7),
              leafMat
            )
            cone.position.y = 0.12 + i * 0.48
            cone.scale.setScalar(0.01)
            cone.castShadow = true
            cone.userData.targetScale = 1
            canopy.add(cone)
            leaves.push(cone)
          }
          canopy.position.y = trunkHeight * 0.42
          return leaves
        },
      }
    case 'willow':
      return {
        trunkHeight: 2.7 + Math.random() * 0.5,
        trunkTop: 0.055,
        trunkBot: 0.12,
        leafMat: leafMatGold,
        glowColor: 0xd4ff4a,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const blobs = [
            { x: 0, y: 0.3, z: 0, s: 1 },
            { x: -0.5, y: -0.12, z: 0.18, s: 0.72 },
            { x: 0.5, y: -0.18, z: -0.12, s: 0.76 },
            { x: 0.12, y: -0.48, z: 0.4, s: 0.62 },
            { x: -0.22, y: -0.62, z: -0.32, s: 0.66 },
            { x: 0.36, y: -0.75, z: 0.08, s: 0.52 },
          ]
          blobs.forEach((pos) => {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry(0.45, 1),
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
    case 'fan':
      return {
        trunkHeight: 2.45 + Math.random() * 0.45,
        trunkTop: 0.042,
        trunkBot: 0.11,
        leafMat: leafMatLime,
        glowColor: 0xccff00,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const ring = [
            { x: 0, y: 0.12, z: 0, s: 0.92 },
            { x: -0.65, y: 0.04, z: 0.12, s: 0.68 },
            { x: 0.65, y: 0.04, z: -0.08, s: 0.7 },
            { x: 0.12, y: 0, z: 0.65, s: 0.66 },
            { x: -0.18, y: 0, z: -0.65, s: 0.68 },
            { x: 0.5, y: -0.04, z: 0.45, s: 0.52 },
            { x: -0.5, y: -0.04, z: -0.4, s: 0.52 },
          ]
          ring.forEach((pos) => {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry(0.4, 1),
              leafMat
            )
            leaf.position.set(pos.x, pos.y, pos.z)
            leaf.scale.setScalar(0.01)
            leaf.castShadow = true
            leaf.userData.targetScale = pos.s
            canopy.add(leaf)
            leaves.push(leaf)
          })
          canopy.position.y = trunkHeight * 0.98
          return leaves
        },
      }
    case 'canopy':
    default:
      return {
        trunkHeight: 2.35 + Math.random() * 0.5,
        trunkTop: 0.065,
        trunkBot: 0.14,
        leafMat: leafMatLime,
        glowColor: 0xccff00,
        buildCanopy: (canopy, trunkHeight, leafMat) => {
          const leaves = []
          const blobs = [
            { x: 0, y: 0.5, z: 0, s: 1.05 },
            { x: -0.45, y: 0.22, z: 0.22, s: 0.72 },
            { x: 0.45, y: 0.18, z: -0.18, s: 0.8 },
            { x: 0.08, y: 0.04, z: 0.45, s: 0.62 },
            { x: -0.22, y: 0, z: -0.4, s: 0.66 },
            { x: 0.3, y: 0.58, z: 0.16, s: 0.52 },
          ]
          blobs.forEach((pos) => {
            const leaf = new THREE.Mesh(
              new THREE.IcosahedronGeometry(0.48, 1),
              leafMat
            )
            leaf.position.set(pos.x, pos.y, pos.z)
            leaf.scale.setScalar(0.01)
            leaf.castShadow = true
            leaf.userData.targetScale = pos.s
            canopy.add(leaf)
            leaves.push(leaf)
          })
          canopy.position.y = trunkHeight
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
  const treeType =
    options.treeType ||
    TREE_TYPES[Math.floor(Math.random() * TREE_TYPES.length)]

  const blueprint = getTypeBlueprint(treeType)
  const trunkHeight = blueprint.trunkHeight
  const leafMat = blueprint.leafMat

  // Frozen world anchor — do not write group.position after this
  const group = new THREE.Group()
  group.position.set(x, y, z)
  group.rotation.y = Math.random() * Math.PI * 2
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
    treeType === 'willow' ? trunkMatDark : trunkMat
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
      const s = leaf.userData.targetScale ?? 1
      leaf.scale.setScalar(s)
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
        const s = leaf.userData.targetScale ?? 1
        if (animate) {
          animate({
            targets: leaf.scale,
            x: s,
            y: s,
            z: s,
            duration: 2400,
            delay: i * 180,
            easing: 'easeOutCubic',
          })
        } else {
          leaf.scale.setScalar(s)
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

  if (startDelay > 0) window.setTimeout(beginGrowth, startDelay)
  else beginGrowth()

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

  const group = new THREE.Group()
  group.position.set(x, y, z)
  group.rotation.y = Math.random() * Math.PI * 2
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
    new THREE.IcosahedronGeometry(0.2 + Math.random() * 0.1, 0),
    Math.random() > 0.5 ? leafMatTeal : leafMatLime
  )
  blob.position.y = stemH + 0.1
  blob.scale.setScalar(0.01)
  blob.castShadow = true
  group.add(blob)

  const animate = typeof window !== 'undefined' && window.anime ? window.anime : null

  const hardFreezeUnder = () => {
    if (animate) {
      animate.remove(stem.scale)
      animate.remove(blob.scale)
    }
    stem.scale.set(1, 1, 1)
    blob.scale.setScalar(1)
    // Keep the stem's shadow; drop the blob's (cheaper, visually unnoticeable)
    blob.castShadow = false
    blob.receiveShadow = false
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
        targets: blob.scale,
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
      hardFreezeUnder()
    }
  }

  if (startDelay > 0) window.setTimeout(grow, startDelay)
  else grow()

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
