const health = document.getElementById('health');
const engines = document.getElementById('engines');
const runs = document.getElementById('runs');
const runsNote = document.getElementById('runsNote');
const dialog = document.getElementById('runDialog');

document.getElementById('runButton').addEventListener('click', function () {
  dialog.showModal();
});

async function loadDashboard() {
  try {
    const healthData = await fetch('/api/health').then(function (r) { return r.json(); });
    health.textContent = healthData.ok ? 'System online' : 'Degraded';

    const engineData = await fetch('/api/engines').then(function (r) { return r.json(); });
    engines.innerHTML = engineData.engines.map(function (engine) {
      return '<article class="engine"><div class="engine-row"><div><h4>' + engine.name + '</h4><p>' + engine.mode + '</p></div><span class="badge">' + engine.status + '</span></div></article>';
    }).join('');

    const latest = await fetch('/api/runs/latest').then(function (r) { return r.json(); });
    if (!latest.runs || latest.runs.length === 0) {
      runs.innerHTML = '<div class="run muted">No published runs yet.</div>';
      runsNote.textContent = latest.note || 'Ready for first run';
      return;
    }

    runs.innerHTML = latest.runs.map(function (run) {
      return '<article class="run"><strong>' + run.engine + '</strong> · ' + run.status + '<br><span class="muted">' + new Date(run.generated_at).toLocaleString() + ' · ' + run.provenance_mode + '</span></article>';
    }).join('');
    runsNote.textContent = latest.runs.length + ' shown';
  } catch (error) {
    console.error(error);
    health.textContent = 'Offline';
    engines.innerHTML = '<div class="run muted">Unable to load engine status.</div>';
  }
}

loadDashboard();
