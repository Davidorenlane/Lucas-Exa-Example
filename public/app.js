const form = document.querySelector("#job-form");
const requestInput = document.querySelector("#request");
const countInput = document.querySelector("#count");
const startButton = document.querySelector("#start-job-button");
const refreshButton = document.querySelector("#refresh-button");
const exportButton = document.querySelector("#export-button");
const statusText = document.querySelector("#status");
const jobMeta = document.querySelector("#job-meta");
const resultsTable = document.querySelector("#results-table");
const jobsList = document.querySelector("#jobs-list");

const state = {
  currentJobId: null,
  pollTimer: null,
  currentRows: [],
  columns: []
};

init().catch((error) => {
  setStatus(`Failed to initialize app: ${error.message}`, true);
});

async function init() {
  const config = await fetchJson("/api/config");

  requestInput.value = config.defaults?.request ?? "";
  countInput.value = String(config.defaults?.count ?? 250);

  form.addEventListener("submit", onStartJob);
  refreshButton.addEventListener("click", loadJobs);
  exportButton.addEventListener("click", exportCurrentJob);

  await loadJobs();
  setStatus("Ready.");
}

async function onStartJob(event) {
  event.preventDefault();

  const request = requestInput.value.trim();
  if (!request) {
    setStatus("Request is required.", true);
    return;
  }

  const count = Number(countInput.value);
  setBusy(true);
  setStatus("Creating job...");

  try {
    const payload = {
      request,
      count: Number.isFinite(count) ? count : 250
    };

    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error ?? "Failed to create job.");
    }

    const job = data.job;
    state.currentJobId = job.id;
    state.currentRows = [];
    state.columns = [];
    renderResults([], []);
    renderJobMeta(job);
    await loadJobs();

    setStatus(`Job started (${job.id}). Waiting for Exa to finish...`);
    startPolling(job.id);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function startPolling(jobId) {
  stopPolling();

  const poll = async () => {
    try {
      const data = await fetchJson(`/api/jobs/${jobId}`);
      const job = data.job;
      renderJobMeta(job);

      if (job.status === "completed") {
        stopPolling();
        setStatus(`Job complete: ${job.rowCount} lead rows`);
        await loadResults(job.id);
        await loadJobs();
        return;
      }

      if (job.status === "failed") {
        stopPolling();
        setStatus(`Job failed: ${job.error ?? "Unknown error"}`, true);
        await loadJobs();
        return;
      }

      setStatus(`Job ${job.status}. Polling...`);
    } catch (error) {
      stopPolling();
      setStatus(`Polling stopped: ${error.message}`, true);
    }
  };

  state.pollTimer = setInterval(poll, 3000);
  void poll();
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function loadResults(jobId) {
  const data = await fetchJson(`/api/jobs/${jobId}/results`);
  state.currentRows = data.rows ?? [];
  state.columns = data.columns ?? [];
  state.currentJobId = jobId;

  renderResults(state.currentRows, state.columns);
  exportButton.disabled = false;
}

async function loadJobs() {
  const data = await fetchJson("/api/jobs");
  renderJobsList(data.jobs ?? []);
}

function renderJobMeta(job) {
  const details = [];

  details.push(`Job ID: ${job.id}`);
  details.push(`Status: ${job.status}`);
  details.push(`Target count: ${job.count}`);
  details.push(`Rows: ${job.rowCount}`);

  if (job.websetId) {
    details.push(`Webset ID: ${job.websetId}`);
  }

  if (job.error) {
    details.push(`Error: ${job.error}`);
  }

  jobMeta.textContent = details.join(" | ");
}

function renderResults(rows, columns) {
  if (!rows.length) {
    resultsTable.innerHTML = "<p>No rows yet.</p>";
    return;
  }

  const header = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => `<td>${escapeHtml(String(row[column] ?? ""))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  resultsTable.innerHTML = `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderJobsList(jobs) {
  if (!jobs.length) {
    jobsList.innerHTML = "<p>No jobs yet.</p>";
    return;
  }

  jobsList.innerHTML = jobs
    .map((job) => {
      const canOpen = job.status === "completed";
      return `<div class="job-item">
        <div><strong>${escapeHtml(job.id)}</strong> (${escapeHtml(job.status)})</div>
        <div>Rows: ${escapeHtml(String(job.rowCount))} | Target: ${escapeHtml(String(job.count))}</div>
        <div class="job-request">${escapeHtml(job.request)}</div>
        <div class="job-actions">
          <button data-action="open" data-job-id="${escapeHtml(job.id)}" ${canOpen ? "" : "disabled"}>Open</button>
          <button data-action="watch" data-job-id="${escapeHtml(job.id)}">Watch</button>
        </div>
      </div>`;
    })
    .join("");

  jobsList.querySelectorAll("button[data-action='open']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = button.getAttribute("data-job-id");
      if (!jobId) return;
      setStatus(`Loading results for ${jobId}...`);
      await loadResults(jobId);
      setStatus(`Loaded results for ${jobId}`);
    });
  });

  jobsList.querySelectorAll("button[data-action='watch']").forEach((button) => {
    button.addEventListener("click", async () => {
      const jobId = button.getAttribute("data-job-id");
      if (!jobId) return;

      state.currentJobId = jobId;
      exportButton.disabled = true;
      state.currentRows = [];
      state.columns = [];
      renderResults([], []);
      setStatus(`Watching job ${jobId}...`);
      startPolling(jobId);
    });
  });
}

function exportCurrentJob() {
  if (!state.currentJobId) {
    setStatus("No job selected.", true);
    return;
  }

  const url = `/api/jobs/${encodeURIComponent(state.currentJobId)}/export.csv`;
  window.location.assign(url);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed: ${response.status}`);
  }

  return data;
}

function setBusy(isBusy) {
  startButton.disabled = isBusy;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
