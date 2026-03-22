/**
 * Substack Note Scheduler - Popup Script
 */

const STATUS_LABELS = {
  pending: 'Scheduled',
  sent: 'Posted',
  failed: 'Failed',
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getAllNotes() {
  const result = await chrome.storage.local.get('scheduledNotes');
  return result.scheduledNotes || {};
}

async function deleteNote(id) {
  const result = await chrome.storage.local.get('scheduledNotes');
  const notes = result.scheduledNotes || {};
  delete notes[id];
  await chrome.storage.local.set({ scheduledNotes: notes });

  // Cancel the alarm if it exists
  await chrome.alarms.clear(id);
}

async function clearSentNotes() {
  const result = await chrome.storage.local.get('scheduledNotes');
  const notes = result.scheduledNotes || {};
  const filtered = Object.fromEntries(
    Object.entries(notes).filter(([, note]) => note.status !== 'sent')
  );
  await chrome.storage.local.set({ scheduledNotes: filtered });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function formatDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderNotes(notes) {
  const list = document.getElementById('notes-list');
  const empty = document.getElementById('empty-state');
  const statusText = document.getElementById('status-text');

  const sorted = Object.values(notes).sort((a, b) => a.scheduledTime - b.scheduledTime);

  if (sorted.length === 0) {
    list.hidden = true;
    empty.hidden = false;
    statusText.textContent = '';
    return;
  }

  empty.hidden = true;
  list.hidden = false;

  const pending = sorted.filter((n) => n.status === 'pending').length;
  statusText.textContent = pending > 0 ? `${pending} pending` : '';

  list.innerHTML = '';

  for (const note of sorted) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id;

    const statusLabel = STATUS_LABELS[note.status] || note.status;
    const timeLabel = note.status === 'sent'
      ? `Posted ${formatDateTime(note.updatedAt || note.scheduledTime)}`
      : `Scheduled ${formatDateTime(note.scheduledTime)}`;

    card.innerHTML = `
      <div class="note-card-top">
        <div class="note-text">${escapeHtml(note.text)}</div>
        <button class="note-delete-btn" title="Remove" data-id="${note.id}" aria-label="Remove note">&times;</button>
      </div>
      <div class="note-card-bottom">
        <span class="note-status status-${note.status}">
          <span class="status-dot"></span>${escapeHtml(statusLabel)}
        </span>
        <span class="note-time">${escapeHtml(timeLabel)}</span>
        ${note.error ? `<span class="note-time" title="${escapeHtml(note.error)}" style="color:#c0392b">&#9432; ${escapeHtml(note.error.slice(0, 40))}</span>` : ''}
      </div>
    `;

    list.appendChild(card);
  }

  // Attach delete handlers
  list.querySelectorAll('.note-delete-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await deleteNote(id);
      await render();
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function render() {
  const notes = await getAllNotes();
  renderNotes(notes);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  await render();

  document.getElementById('clear-sent-btn').addEventListener('click', async () => {
    await clearSentNotes();
    await render();
  });

  // Refresh when storage changes (e.g. background updates status)
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.scheduledNotes) render();
  });
});
