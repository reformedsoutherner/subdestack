/**
 * Substack Note Scheduler - Content Script
 *
 * Responsibilities:
 *  - Watch the DOM for Substack's note composer and inject a "Schedule" button.
 *  - Show a scheduling modal (date + time picker) when that button is clicked.
 *  - Capture the note text, save it to chrome.storage.local, and register an alarm.
 *  - Listen for messages from the background worker to auto-post a note.
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Selectors - update here if Substack changes its DOM
  // ---------------------------------------------------------------------------

  // The row of action buttons at the bottom of the compose form
  const ACTION_ROW_SELECTORS = [
    '[class*="noteComposerActions"]',
    '[class*="compose-actions"]',
    '[class*="composer-actions"]',
    '[class*="NoteComposerActions"]',
    'form [class*="actions"]',
  ];

  // The "Post" submit button inside the compose form
  const POST_BUTTON_SELECTORS = [
    'button[data-testid="post-button"]',
    'button[data-testid="publish-button"]',
    'button[type="submit"]',
  ];

  // The contenteditable note editor
  const EDITOR_SELECTORS = [
    '.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"].ProseMirror',
    'div[contenteditable="true"][class*="editor"]',
    'div[contenteditable="true"]',
  ];

  // The compose form container (used to scope searches)
  const FORM_SELECTORS = [
    'form[class*="noteComposer"]',
    'form[class*="compose"]',
    '[class*="noteComposer"]',
    '[class*="NoteComposer"]',
    '[class*="compose-form"]',
  ];

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function findElement(selectors, root = document) {
    for (const sel of selectors) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

  function findPostButton(root = document) {
    const bySelector = findElement(POST_BUTTON_SELECTORS, root);
    if (bySelector) return bySelector;

    // Find by visible button text
    const buttons = root.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (['post', 'publish'].includes(text)) return btn;
    }
    return null;
  }

  function getEditorText(editor) {
    return editor ? editor.innerText.trim() : '';
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function generateId() {
    return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ---------------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------------

  async function saveNote(note) {
    const result = await chrome.storage.local.get('scheduledNotes');
    const notes = result.scheduledNotes || {};
    notes[note.id] = note;
    await chrome.storage.local.set({ scheduledNotes: notes });
  }

  // ---------------------------------------------------------------------------
  // Schedule button injection
  // ---------------------------------------------------------------------------

  const SCHEDULE_BTN_CLASS = 'sns-schedule-btn';
  const INJECTED_ATTR = 'data-sns-injected';

  function injectScheduleButton(form) {
    if (form.hasAttribute(INJECTED_ATTR)) return;
    form.setAttribute(INJECTED_ATTR, '1');

    const postBtn = findPostButton(form);
    if (!postBtn) return;

    const scheduleBtn = document.createElement('button');
    scheduleBtn.type = 'button';
    scheduleBtn.className = SCHEDULE_BTN_CLASS;
    scheduleBtn.textContent = 'Schedule';
    scheduleBtn.title = 'Schedule this note for later';

    scheduleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleScheduleClick(form, postBtn);
    });

    // Insert the Schedule button directly before the Post button
    postBtn.parentNode.insertBefore(scheduleBtn, postBtn);
  }

  // ---------------------------------------------------------------------------
  // Schedule modal
  // ---------------------------------------------------------------------------

  function handleScheduleClick(form, postBtn) {
    const editor = findElement(EDITOR_SELECTORS, form) || findElement(EDITOR_SELECTORS);
    const noteText = getEditorText(editor);

    if (!noteText) {
      showToast('Please write your note before scheduling.', 'error');
      return;
    }

    showScheduleModal(noteText, async (scheduledTime) => {
      const note = {
        id: generateId(),
        text: noteText,
        scheduledTime,
        status: 'pending',
        createdAt: Date.now(),
      };

      await saveNote(note);

      // Ask background to register the alarm
      chrome.runtime.sendMessage({ action: 'SCHEDULE_NOTE', note });

      // Clear the editor
      clearEditor(editor);

      const when = new Date(scheduledTime).toLocaleString();
      showToast(`Note scheduled for ${when}`, 'success');
    });
  }

  function showScheduleModal(noteText, onConfirm) {
    // Remove any existing modal
    document.getElementById('sns-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'sns-modal-overlay';

    // Default: round up to next hour
    const defaultTime = new Date(Math.ceil(Date.now() / 3600000) * 3600000);
    const localISO = new Date(defaultTime - defaultTime.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);

    overlay.innerHTML = `
      <div class="sns-modal">
        <div class="sns-modal-header">
          <span class="sns-modal-title">Schedule Note</span>
          <button class="sns-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="sns-modal-preview">
          <div class="sns-preview-label">Note preview</div>
          <div class="sns-preview-text">${escapeHtml(noteText.slice(0, 200))}${noteText.length > 200 ? '…' : ''}</div>
        </div>
        <div class="sns-modal-body">
          <label class="sns-label" for="sns-datetime">Post at</label>
          <input
            type="datetime-local"
            id="sns-datetime"
            class="sns-datetime-input"
            value="${localISO}"
            min="${localISO}"
          />
          <div class="sns-timezone-hint">Times are in your local timezone.</div>
        </div>
        <div class="sns-modal-footer">
          <button class="sns-btn sns-btn-secondary sns-cancel-btn">Cancel</button>
          <button class="sns-btn sns-btn-primary sns-confirm-btn">Schedule</button>
        </div>
      </div>
    `;

    overlay.querySelector('.sns-modal-close').addEventListener('click', () => overlay.remove());
    overlay.querySelector('.sns-cancel-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector('.sns-confirm-btn').addEventListener('click', () => {
      const input = overlay.querySelector('#sns-datetime');
      const scheduledTime = new Date(input.value).getTime();

      if (!scheduledTime || isNaN(scheduledTime)) {
        showToast('Please pick a valid date and time.', 'error');
        return;
      }
      if (scheduledTime <= Date.now()) {
        showToast('Scheduled time must be in the future.', 'error');
        return;
      }

      overlay.remove();
      onConfirm(scheduledTime);
    });

    document.body.appendChild(overlay);
    overlay.querySelector('#sns-datetime').focus();
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Editor helpers
  // ---------------------------------------------------------------------------

  function clearEditor(editor) {
    if (!editor) return;
    editor.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
  }

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  function showToast(message, type = 'info') {
    const existing = document.getElementById('sns-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'sns-toast';
    toast.className = `sns-toast sns-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => toast.classList.add('sns-toast-show'));

    setTimeout(() => {
      toast.classList.remove('sns-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // ---------------------------------------------------------------------------
  // DOM observer - watches for the compose form
  // ---------------------------------------------------------------------------

  function scanAndInject() {
    const forms = [
      ...document.querySelectorAll(FORM_SELECTORS.join(', ')),
    ];

    // If no form found by our selectors, look for a form containing a Post button
    if (forms.length === 0) {
      const postBtns = document.querySelectorAll('button');
      for (const btn of postBtns) {
        const text = btn.textContent?.trim().toLowerCase();
        if (['post', 'publish'].includes(text)) {
          const form = btn.closest('form') || btn.closest('[class*="composer"]') || btn.closest('[class*="compose"]');
          if (form && !form.hasAttribute(INJECTED_ATTR)) {
            injectScheduleButton(form);
          }
        }
      }
      return;
    }

    for (const form of forms) {
      if (!form.hasAttribute(INJECTED_ATTR)) {
        injectScheduleButton(form);
      }
    }
  }

  // Run once on load
  scanAndInject();

  // Watch for dynamic changes (Substack is a SPA)
  const observer = new MutationObserver(() => scanAndInject());
  observer.observe(document.body, { childList: true, subtree: true });

  // ---------------------------------------------------------------------------
  // Message listener from background (auto-post when alarm fires)
  // ---------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'SCHEDULE_NOTE') {
      // Background confirms alarm was registered - no action needed from content
      sendResponse({ ok: true });
    }
  });

})();
