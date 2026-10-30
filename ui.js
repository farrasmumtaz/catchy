export function setupInterface() {
  const $ = id => document.getElementById(id);
  const viewport = window.visualViewport;
  const resize = () => {
    // Pinch zoom must keep its normal browser behavior.
    if (viewport && viewport.scale !== 1) return;
    document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
    document.documentElement.dataset.keyboard = String(Boolean(viewport && window.innerHeight - viewport.height > 120));
  };
  viewport?.addEventListener('resize', resize);
  window.addEventListener('resize', resize);
  resize();

  for (const [inputId, buttonId, dialogId, name] of [
    ['appPassword', 'toggleAppPassword', 'auth', 'aplikasi'],
    ['password', 'toggleSipPassword', 'settings', 'SIP'],
  ]) {
    const input = $(inputId), button = $(buttonId);
    const show = visible => {
      input.type = visible ? 'text' : 'password';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', `${visible ? 'Sembunyikan' : 'Tampilkan'} password ${name}`);
    };
    button.addEventListener('click', () => show(input.type === 'password'));
    $(dialogId).addEventListener('close', () => show(false));
    $(dialogId).addEventListener('cancel', () => show(false));
    $(dialogId).querySelector('form').addEventListener('submit', () => show(false));
    if (inputId === 'appPassword') $('authMode').addEventListener('click', () => show(false));
  }

  $('message').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    if ($('message').disabled || !($('message').value.trim())) return;
    event.preventDefault();
    $('composer').requestSubmit();
  });
}
