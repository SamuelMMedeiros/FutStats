(() => {
  const nav = document.querySelector('#score-primary-nav');
  const count = document.querySelector('#score-fixture-count');
  const liveCount = document.querySelector('#score-live-count');
  const liveKpi = document.querySelector('#score-live-kpi');
  const aiCount = document.querySelector('#score-ai-count');
  const aiKpi = document.querySelector('#score-ai-kpi');
  const coverage = document.querySelector('#score-coverage-label');
  if (!nav) return;

  const buttons = [...nav.querySelectorAll('[data-score-view]')];
  const setActive = (view) => {
    buttons.forEach(button => {
      const active = button.dataset.scoreView === view;
      button.classList.toggle('bg-slate-700', active);
      button.classList.toggle('text-white', active);
      button.classList.toggle('shadow-inner', active);
      button.classList.toggle('text-slate-300', !active);
    });
  };

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.scoreView;
      setActive(view);
      window.dispatchEvent(new CustomEvent('score:view', { detail: { view } }));
    });
  });

  document.querySelectorAll('[data-score-league]').forEach(button => {
    button.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('score:league', { detail: { value: button.dataset.scoreLeague } }));
    });
  });

  document.querySelectorAll('[data-score-date]').forEach(button => {
    button.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('score:date', { detail: { value: button.dataset.scoreDate } }));
    });
  });

  window.ScoreShell = {
    setActive,
    sync(data = {}) {
      if (count) count.textContent = Number(data.total || 0).toLocaleString('pt-BR');
      if (liveCount) liveCount.textContent = Number(data.live || 0).toLocaleString('pt-BR');
      if (liveKpi) liveKpi.textContent = Number(data.live || 0).toLocaleString('pt-BR');
      if (aiCount) aiCount.textContent = Number(data.ai || 0).toLocaleString('pt-BR');
      if (aiKpi) aiKpi.textContent = Number(data.ai || 0).toLocaleString('pt-BR');
      if (coverage) coverage.textContent = data.coverage || 'Aguardando snapshot';
    }
  };

  setActive('today');
})();
