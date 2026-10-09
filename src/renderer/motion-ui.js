/* Event-driven feedback; only the decorative CSS orbits run while the window is visible. */
const LadMotion = (() => {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const running = new Set();
  const effects = new Map();
  let lastPage = '', lastProgress = null, litCard = null, pointerFrame = 0;

  function level() {
    if (document.hidden || preference.matches) return 'off';
    return document.documentElement.dataset.motion || 'full';
  }

  function removeEffect(root) {
    const animations = effects.get(root);
    effects.delete(root);
    if (animations) for (const animation of animations) animation.cancel();
    root.remove();
  }

  function addEffect(root, parent = document.body) {
    // Bound decorative work independently of the queue that persists every intake click.
    if (effects.size >= 12) removeEffect(effects.keys().next().value);
    effects.set(root, new Set());
    root.setAttribute('aria-hidden', 'true');
    parent.append(root);
    return root;
  }

  function clearLight() {
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = 0;
    litCard?.removeAttribute('data-lad-light');
    litCard = null;
  }

  function stop() {
    for (const animation of running) animation.cancel();
    running.clear();
    for (const root of [...effects.keys()]) removeEffect(root);
    clearLight();
  }

  function animate(element, frames, options, owner) {
    if (!element?.isConnected || !element.animate || level() === 'off') return;
    const animation = element.animate(frames, options);
    running.add(animation);
    effects.get(owner)?.add(animation);
    animation.finished.catch(() => {}).finally(() => {
      running.delete(animation);
      effects.get(owner)?.delete(animation);
    });
    return animation;
  }

  function finishEffect(root, animation) {
    if (!animation) { removeEffect(root); return; }
    animation.finished.catch(() => {}).finally(() => removeEffect(root));
  }

  function enterPage(mode, tab) {
    const key = mode + ':' + tab;
    const changed = key !== lastPage;
    lastPage = key;
    // A redraw never hides the current screen or moves intake hit targets.
    stop();
    const page = document.querySelector('.page-view');
    const ring = page?.querySelector('[data-progress-arc]');
    const progress = ring?.getAttribute('stroke-dasharray');
    const previousProgress = lastProgress;
    if (ring) lastProgress = progress;
    if (mode === 'widget' || level() === 'off') return;
    if (level() === 'reduced') {
      if (changed) animate(page, [{opacity:.65}, {opacity:1}], {duration:110});
      return;
    }
    if (changed) {
      const sections = [...page.children].filter(element => !element.hidden).slice(0, 8);
      sections.forEach((element, index) => animate(element,
        [{opacity:0, transform:'translateY(10px)'}, {opacity:1, transform:'translateY(0)'}],
        {duration:280, delay:index * 28, easing:'cubic-bezier(.2,.75,.25,1)', fill:'backwards'}));
    }
    if (ring && (changed || previousProgress !== progress)) animate(ring,
      [{strokeDasharray:changed ? '0 100' : previousProgress || '0 100'}, {strokeDasharray:progress}],
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

  function svgElement(name, attributes) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function intakeAccepted(employeeId) {
    if (level() !== 'full') return;
    const target = [...document.querySelectorAll('.sector[data-employee-id], [data-widget-object]')]
      .find(element => (element.dataset.employeeId || element.dataset.widgetObject) === employeeId);
    if (!target) return;
    if (target.matches('.sector')) {
      const label = target.querySelector('.sector-name');
      const x = 300 + (Number(label.getAttribute('x')) - 300) * .7;
      const y = 300 + (Number(label.getAttribute('y')) + 10 - 300) * .7;
      const root = addEffect(svgElement('svg', {class:'lad-intake-fx', viewBox:'0 0 600 600'}), target.ownerSVGElement.parentElement);
      const badge = svgElement('g', {class:'lad-intake-pill'});
      badge.append(svgElement('rect', {class:'lad-intake-back', x:x-38, y:y-23, width:76, height:46, rx:23}));
      const number = svgElement('text', {class:'lad-intake-number', x, y});
      number.textContent = '+1';
      badge.append(number);
      root.append(badge);
      animate(badge, [{transform:'translateY(10px)', opacity:0}, {transform:'translateY(0)', opacity:1, offset:.15}, {transform:'translateY(-12px)', opacity:1, offset:.65}, {transform:'translateY(-34px)', opacity:0}],
        {duration:1050, easing:'ease-out'}, root);
      for (let i = 0; i < 6; i++) {
        const angle = i * Math.PI / 3, dx = Math.cos(angle), dy = Math.sin(angle);
        const spark = svgElement('path', {class:'lad-intake-spark', d:'M '+(x+dx*27)+' '+(y+dy*27)+' l '+(dx*9)+' '+(dy*9)});
        root.append(spark);
        animate(spark, [{transform:'translate(0,0)', opacity:1}, {transform:'translate('+dx*26+'px,'+(dy*26-12)+'px)', opacity:0}],
          {duration:620, easing:'ease-out'}, root);
      }
      finishEffect(root, animate(root, [{opacity:1}, {opacity:1}], {duration:1070}, root));
    } else {
      const bounds = target.getBoundingClientRect();
      const root = addEffect(document.createElement('span'));
      root.className = 'lad-intake-badge';
      root.textContent = '+1';
      root.style.left = Math.max(8, Math.min(innerWidth - 50, bounds.right - 46)) + 'px';
      root.style.top = Math.max(8, bounds.top + 4) + 'px';
      finishEffect(root, animate(root, [{transform:'translateY(6px)', opacity:0}, {transform:'translateY(-2px)', opacity:1, offset:.2}, {transform:'translateY(-20px)', opacity:0}],
        {duration:750, easing:'ease-out'}, root));
    }
  }

  function ripple(button, clientX, clientY) {
    if (level() !== 'full' || button.disabled) return;
    const bounds = button.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const root = addEffect(document.createElement('span'));
    root.className = 'lad-ripple-frame';
    Object.assign(root.style, {left:bounds.left+'px', top:bounds.top+'px', width:bounds.width+'px', height:bounds.height+'px', borderRadius:getComputedStyle(button).borderRadius});
    const dot = document.createElement('span'), size = Math.hypot(bounds.width, bounds.height) * 2;
    dot.className = 'lad-ripple';
    Object.assign(dot.style, {width:size+'px', height:size+'px', left:(clientX - bounds.left - size/2)+'px', top:(clientY - bounds.top - size/2)+'px'});
    root.append(dot);
    finishEffect(root, animate(dot, [{transform:'scale(.05)', opacity:1}, {transform:'scale(1)', opacity:0}], {duration:480, easing:'ease-out'}, root));
  }

  document.addEventListener('pointerdown', event => {
    const button = event.target.closest('button');
    if (button && event.button === 0) ripple(button, event.clientX, event.clientY);
  }, {passive:true});
  document.addEventListener('keydown', event => {
    const button = event.target.closest('button');
    if (button && !event.repeat && ['Enter', ' '].includes(event.key)) {
      const bounds = button.getBoundingClientRect();
      ripple(button, bounds.left + bounds.width/2, bounds.top + bounds.height/2);
    }
  });
  document.addEventListener('pointermove', event => {
    if (level() !== 'full' || !finePointer.matches) { clearLight(); return; }
    const card = event.target.closest('.work-person, .day-metric');
    if (card !== litCard) { clearLight(); litCard = card; }
    if (!card) return;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0;
      if (!card.isConnected || level() !== 'full') return;
      const bounds = card.getBoundingClientRect();
      card.style.setProperty('--lad-light-x', (event.clientX - bounds.left)+'px');
      card.style.setProperty('--lad-light-y', (event.clientY - bounds.top)+'px');
      card.setAttribute('data-lad-light', '');
    });
  }, {passive:true});
  document.addEventListener('pointerleave', clearLight);

  function sync() {
    document.documentElement.dataset.fxPaused = String(level() !== 'full');
    if (level() !== 'full') stop();
  }
  preference.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  sync();
  return {enterPage, enterDialog, countChanged, intakeAccepted, sync, level};
})();
