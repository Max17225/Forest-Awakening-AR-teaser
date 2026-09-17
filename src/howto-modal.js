/**
 * Two-page how-to modal shown after START AR, before tap-to-plant.
 */

let modalEl = null
let page1 = null
let page2 = null
let onDoneCb = null

function ensureDom() {
  modalEl = document.getElementById('howto-modal')
  page1 = document.getElementById('howto-page-1')
  page2 = document.getElementById('howto-page-2')
  return Boolean(modalEl && page1 && page2)
}

function showPage(n) {
  if (page1) page1.classList.toggle('hidden', n !== 1)
  if (page2) page2.classList.toggle('hidden', n !== 2)
}

export function showHowtoModal() {
  if (!ensureDom()) {
    window.__FA_HOWTO_DONE__ = true
    if (typeof onDoneCb === 'function') onDoneCb()
    return
  }
  window.__FA_HOWTO_DONE__ = false
  showPage(1)
  modalEl.classList.remove('hidden')
  modalEl.setAttribute('aria-hidden', 'false')
}

export function hideHowtoModal() {
  if (!modalEl) return
  modalEl.classList.add('hidden')
  modalEl.setAttribute('aria-hidden', 'true')
}

/**
 * @param {{ onDone?: () => void }} [options]
 */
export function initHowtoModal(options = {}) {
  if (!ensureDom()) return
  onDoneCb = options.onDone || null

  const nextBtn = document.getElementById('howto-next')
  const doneBtn = document.getElementById('howto-done')
  const card = modalEl.querySelector('.howto-card')

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      showPage(2)
    })
  }
  if (doneBtn) {
    doneBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      window.__FA_HOWTO_DONE__ = true
      hideHowtoModal()
      if (typeof onDoneCb === 'function') onDoneCb()
    })
  }
  if (card) {
    ;['touchstart', 'touchend', 'pointerdown', 'click'].forEach((evt) => {
      card.addEventListener(evt, (e) => e.stopPropagation())
    })
  }
}
