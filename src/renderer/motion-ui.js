/* Short, cancellable feedback. No timers or background loops; intake hit targets stay fixed. */
const LadMotion = (() => {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const running = new Set();
  let lastPage = '';

  function level() {
    if (document.hidden || preference.matches) return 'off';
    return document.documentElement.dataset.motion || 'full';
  }

  function stop() {
    for (const animation of running) animation.cancel();
    running.clear();
  }

  function animate(element, frames, options) {
    if (!element?.isConnected || !element.animate || level() === 'off') return;
    const animation = element.animate(frames, options);
    running.add(animation);
    animation.finished.catch(() => {}).finally(() => running.delete(animation));
    return animation;
  }

  function enterPage(mode, tab) {
    const key = `${mode}:${tab}`;
    const changed = key !== lastPage;
    lastPage = key;
    // Preserve visibility and keyboard focus on background redraws and fast intake.
    stop();
    if (mode === 'widget' || !changed || level() === 'off') return;
    const page = document.querySelector('.page-view');
    if (level() === 'reduced') {
      animate(page, [{opacity:.65}, {opacity:1}], {duration:110});
      return;
    }
    const sections = [...page.children].filter(element => !element.hidden).slice(0, 8);
    sections.forEach((element, index) => animate(element,
      [{opacity:0, transform:'translateY(10px)'}, {opacity:1, transform:'translateY(0)'}],
      {duration:280, delay:index * 28, easing:'cubic-bezier(.2,.75,.25,1)', fill:'backwards'}));
    const ring = page.querySelector('[data-progress-arc]');
    if (ring) animate(ring, [{strokeDasharray:'0 100'}, {strokeDasharray:ring.getAttribute('stroke-dasharray')}],
      {duration:650, easing:'cubic-bezier(.2,.75,.25,1)'});
  }

  function enterDialog(dialog) {
    if (level() === 'off') return;
    const frames = level() === 'full'
      ? [{opacity:0, transform:'translateY(8px) scale(.99)'}, {opacity:1, transform:'translateY(0) scale(1)'}]
      : [{opacity:.65}, {opacity:1}];
    animate(dialog, frames, {duration:level() === 'full' ? 190 : 100, easing:'cubic-bezier(.2,.75,.25,1)'});
  }

  function countChanged(element) {
    animate(element, [{opacity:.4}, {opacity:1}], {duration:180, easing:'ease-out'});
  }

  function sync() { if (level() !== 'full') stop(); }
  preference.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  return {enterPage, enterDialog, countChanged, sync, level};
})();
