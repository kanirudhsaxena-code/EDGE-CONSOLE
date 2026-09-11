const health = document.getElementById('health');
const engines = document.getElementById('engines');
const runs = document.getElementById('runs');
const runsNote = document.getElementById('runsNote');
const dialog = document.getElementById('runDialog');
const fiveDrState = document.getElementById('fiveDrState');
const fiveDrSummary = document.getElementById('fiveDrSummary');

document.getElementById('runButton').addEventListener('click', function () {
  dialog.showModal();
});

document.getElementById('navRun').addEventListener('click', function () {
  dialog.showModal();
});

document.getElementById('nav5dr').addEventListener('click', function () {
  document.getElementById('fiveDrPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function render5dr(run) {
  if (!run) {
    fiveDrState.textContent = 'READY';
    fiveDrSummary.innerHTML = [
      '<article class="run">',
      '<strong>Adapter ready for first 5DR publication</strong>',
      '<p class="muted">The console now validates the current 5DR V2.1.2 release contract before a run can be persisted.</p>',
      '<div class="check-grid">',
      '<span>✓ Forecast Assessment</span><span>✓ Recommendation Assessment</span>',
      '<span>✓ D+1 → D+5 slots</span><span>✓ Recommendation ledger</span>',
      '</div>',
      '</article>'
    ].join('');
    return;
  }

  const result = run.result || {};
  fiveDrState.textContent = run.status || 'PUBLISHED';
  fiveDrSummary.innerHTML = [
    '<article class="run">',
    '<div class="engine-row"><strong>' + escapeHtml(run.run_id) + '</strong><span class="badge">' + escapeHtml(run.provenance_mode) + '</span></div>',
    '<p class="muted">' + escapeHtml(new Date(run.generated_at).toLocaleString()) + ' · ' + escapeHtml(run.framework_version) + '</p>',
    '<div class="metric"><span>Forecast assessment</span><strong>' + escapeHtml(result.forecast_assessment || 'Not available') + '</strong></div>',
    '<div class="metric"><span>Recommendation assessment</span><strong>' + escapeHtml(result.recommendation_assessment || 'Not available') + '</strong></div>',
    '</article>'
  ].join('');
}

async function loadDashboard() {
  try {
    const healthData = await fetch('/api/health').then(function (r) { return r.json(); });
    health.textContent = healthData.ok ? 'System online' : 'Degraded';

    const engineData = await fetch('/api/engines').then(function (r) { return r.json(); });
    engines.innerHTML = engineData.engines.map(function (engine) {
      return '<article class="engine"><div class="engine-row"><div><h4>' + escapeHtml(engine.name) + '</h4><p>' + escapeHtml(engine.mode) + ' · v' + escapeHtml(engine.version || '—') + '</p></div><span class="badge">' + escapeHtml(engine.status) + '</span></div></article>';
    }).join('');

    const fiveDr = await fetch('/api/5dr/latest').then(function (r) { return r.json(); });
    render5dr(fiveDr.run || null);

    const latest = await fetch('/api/runs/latest').then(function (r) { return r.json(); });
    if (!latest.runs || latest.runs.length === 0) {
      runs.innerHTML = '<div class="run muted">No published runs yet.</div>';
      runsNote.textContent = latest.note || 'Ready for first run';
      return;
    }

    runs.innerHTML = latest.runs.map(function (run) {
      return '<article class="run"><strong>' + escapeHtml(run.engine) + '</strong> · ' + escapeHtml(run.status) + '<br><span class="muted">' + escapeHtml(new Date(run.generated_at).toLocaleString()) + ' · ' + escapeHtml(run.provenance_mode) + '</span></article>';
    }).join('');
    runsNote.textContent = latest.runs.length + ' shown';
  } catch (error) {
    console.error(error);
    health.textContent = 'Offline';
    engines.innerHTML = '<div class="run muted">Unable to load engine status.</div>';
    fiveDrState.textContent = 'ERROR';
    fiveDrSummary.innerHTML = '<div class="run muted">Unable to load 5DR integration status.</div>';
  }
}

loadDashboard();
