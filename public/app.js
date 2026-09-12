const health = document.getElementById('health');
const engines = document.getElementById('engines');
const runs = document.getElementById('runs');
const runsNote = document.getElementById('runsNote');
const dialog = document.getElementById('runDialog');
const fiveDrState = document.getElementById('fiveDrState');
const fiveDrSummary = document.getElementById('fiveDrSummary');
const runForm = document.getElementById('runForm');
const runEngine = document.getElementById('runEngine');
const evidenceMode = document.getElementById('evidenceMode');
const evidenceFiles = document.getElementById('evidenceFiles');
const fileSelection = document.getElementById('fileSelection');
const uploadStatus = document.getElementById('uploadStatus');
const uploadButton = document.getElementById('uploadEvidenceButton');

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

document.getElementById('runButton').addEventListener('click', function () {
  dialog.showModal();
});

document.getElementById('navRun').addEventListener('click', function () {
  dialog.showModal();
});

document.getElementById('closeRunDialog').addEventListener('click', function () {
  dialog.close();
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

function readableBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function setUploadStatus(message, state) {
  uploadStatus.className = 'upload-status' + (state ? ' ' + state : '');
  uploadStatus.textContent = message || '';
}

function validateFiles(files) {
  const errors = [];
  if (!files.length) errors.push('Select at least one evidence file.');
  if (files.length > MAX_FILES) errors.push('Maximum 20 files are allowed in one batch.');
  files.forEach(function (file) {
    if (!ALLOWED_TYPES.has(file.type)) errors.push(file.name + ': unsupported file type.');
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) errors.push(file.name + ': file must be 10 MB or smaller.');
  });
  return errors;
}

function renderFileSelection() {
  const files = Array.from(evidenceFiles.files || []);
  if (!files.length) {
    fileSelection.className = 'file-selection muted';
    fileSelection.textContent = 'No files selected.';
    setUploadStatus('', '');
    return;
  }

  const errors = validateFiles(files);
  const totalBytes = files.reduce(function (sum, file) { return sum + file.size; }, 0);
  fileSelection.className = 'file-selection';
  fileSelection.innerHTML = [
    '<strong>' + files.length + ' file' + (files.length === 1 ? '' : 's') + ' selected</strong>',
    '<span>' + escapeHtml(readableBytes(totalBytes)) + ' total</span>',
    '<span>' + files.slice(0, 4).map(function (file) { return escapeHtml(file.name); }).join(' · ') + (files.length > 4 ? ' · +' + (files.length - 4) + ' more' : '') + '</span>'
  ].join('');

  if (errors.length) setUploadStatus(errors[0], 'error');
  else setUploadStatus('Ready to stage evidence privately.', 'ready');
}

evidenceFiles.addEventListener('change', renderFileSelection);

async function createRunRequest(batchId) {
  const response = await fetch('/api/5dr/run-requests', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batch_id: batchId })
  });
  const data = await response.json().catch(function () { return {}; });
  if (!response.ok) throw new Error(data.error || 'Could not create 5DR run request.');
  return data.request;
}

runForm.addEventListener('submit', async function (event) {
  event.preventDefault();
  const files = Array.from(evidenceFiles.files || []);
  const errors = validateFiles(files);
  if (errors.length) {
    setUploadStatus(errors[0], 'error');
    return;
  }
  if (runEngine.value !== '5DR') {
    setUploadStatus('Evidence upload is currently enabled for 5DR only.', 'error');
    return;
  }

  const form = new FormData();
  form.append('engine', '5DR');
  form.append('provenance_mode', evidenceMode.value);
  form.append('captured_at', new Date().toISOString());
  files.forEach(function (file) { form.append('files', file, file.name); });

  uploadButton.disabled = true;
  uploadButton.textContent = 'Preparing…';
  setUploadStatus('Uploading securely to private evidence storage…', 'working');

  try {
    const response = await fetch('/api/evidence/upload', { method: 'POST', body: form });
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const detail = Array.isArray(data.details) ? data.details.join(' ') : '';
      throw new Error(data.error || detail || 'Evidence upload failed.');
    }

    setUploadStatus('Evidence staged. Creating 5DR engine request…', 'working');
    const request = await createRunRequest(data.batch_id);
    setUploadStatus('5DR request ready for engine processing · ' + request.request_id + '.', 'success');
    fileSelection.innerHTML = [
      '<strong>Evidence + run request ready</strong>',
      '<span>' + data.file_count + ' file' + (data.file_count === 1 ? '' : 's') + ' secured in private R2</span>',
      '<span>Request status: ' + escapeHtml(request.status) + '</span>'
    ].join('');
    evidenceFiles.value = '';
    loadDashboard();
  } catch (error) {
    console.error(error);
    setUploadStatus(error.message || 'Evidence preparation failed.', 'error');
  } finally {
    uploadButton.disabled = false;
    uploadButton.textContent = 'Stage evidence';
  }
});

function render5dr(run, request) {
  if (!run) {
    fiveDrState.textContent = request ? request.status : 'READY';
    const requestBlock = request ? [
      '<div class="metric"><span>Latest engine request</span><strong>' + escapeHtml(request.request_id) + '</strong></div>',
      '<div class="metric"><span>Request status</span><strong>' + escapeHtml(request.status) + '</strong></div>',
      '<p class="muted">Evidence batch ' + escapeHtml(request.batch_id) + ' · ' + escapeHtml(request.metadata && request.metadata.evidence_file_count ? request.metadata.evidence_file_count : '—') + ' file(s)</p>'
    ].join('') : '<p class="muted">No engine request has been created yet.</p>';
    fiveDrSummary.innerHTML = [
      '<article class="run">',
      '<strong>5DR V2.1.2 integration</strong>',
      requestBlock,
      '<p class="muted">The next adapter stage is evidence classification/normalization followed by 5DR engine execution. Production publication remains blocked until the complete V2.1.2 release contract validates.</p>',
      '<div class="check-grid">',
      '<span>✓ Private evidence intake</span><span>✓ Run request queue</span>',
      '<span>✓ Output contract validation</span><span>✓ Immutable publication path</span>',
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
    const requestData = await fetch('/api/5dr/run-requests/latest').then(function (r) { return r.json(); });
    render5dr(fiveDr.run || null, requestData.request || null);

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
