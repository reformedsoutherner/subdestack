/**
 * Substack Note Scheduler - Background Service Worker
 *
 * Responsibilities:
 *  - Restore alarms on install/startup for any pending notes still in storage.
 *  - When an alarm fires, find (or create) a Substack tab and trigger posting.
 *  - Update note status in storage after a successful or failed post attempt.
 */

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

async function getNote(id) {
  const result = await chrome.storage.local.get('scheduledNotes');
  const notes = result.scheduledNotes || {};
  return notes[id] || null;
}

async function getAllNotes() {
  const result = await chrome.storage.local.get('scheduledNotes');
  return result.scheduledNotes || {};
}

async function updateNoteStatus(id, status, error = null) {
  const result = await chrome.storage.local.get('scheduledNotes');
  const notes = result.scheduledNotes || {};
  if (notes[id]) {
    notes[id].status = status;
    if (error) notes[id].error = error;
    notes[id].updatedAt = Date.now();
    await chrome.storage.local.set({ scheduledNotes: notes });
  }
}

// ---------------------------------------------------------------------------
// Alarm management
// ---------------------------------------------------------------------------

async function restoreAlarms() {
  const notes = await getAllNotes();
  const now = Date.now();
  for (const note of Object.values(notes)) {
    if (note.status !== 'pending') continue;
    if (note.scheduledTime <= now) {
      // Overdue - fire immediately (1s delay)
      chrome.alarms.create(note.id, { when: now + 1000 });
    } else {
      chrome.alarms.create(note.id, { when: note.scheduledTime });
    }
  }
}

chrome.runtime.onInstalled.addListener(restoreAlarms);
chrome.runtime.onStartup.addListener(restoreAlarms);

// ---------------------------------------------------------------------------
// Alarm handler - triggers posting
// ---------------------------------------------------------------------------

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const note = await getNote(alarm.name);
  if (!note || note.status !== 'pending') return;

  try {
    await triggerPost(note);
  } catch (err) {
    console.error('[Scheduler] Failed to post note:', err);
    await updateNoteStatus(note.id, 'failed', err.message);
    notifyUser(
      'Scheduled note failed to post',
      `"${note.text.slice(0, 60)}..." — ${err.message}`
    );
  }
});

// ---------------------------------------------------------------------------
// Posting logic
// ---------------------------------------------------------------------------

async function triggerPost(note) {
  // Find an existing Substack tab or create one
  const tabs = await chrome.tabs.query({ url: 'https://*.substack.com/*' });

  let tab;
  let createdTab = false;

  if (tabs.length > 0) {
    tab = tabs[0];
  } else {
    tab = await chrome.tabs.create({
      url: 'https://substack.com/notes',
      active: false,
    });
    createdTab = true;
    await waitForTabLoad(tab.id);
  }

  // Inject the auto-post script into the tab
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: autoPostInPage,
    args: [note],
  });

  const result = results?.[0]?.result;

  if (result?.success) {
    await updateNoteStatus(note.id, 'sent');
    notifyUser('Note posted!', note.text.slice(0, 80));
  } else {
    const errMsg = result?.error || 'Unknown error during post';
    throw new Error(errMsg);
  }

  // Clean up the tab we created if the user didn't already have one open
  if (createdTab) {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Resolves when the tab completes loading (or times out after 15s)
function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, 15000);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// ---------------------------------------------------------------------------
// autoPostInPage - injected into the Substack tab via executeScript
//
// This function runs in the PAGE context (not the extension context), so it
// cannot reference any variables or imports from this file.  All dependencies
// must be passed as arguments or defined inline.
// ---------------------------------------------------------------------------

function autoPostInPage(note) {
  return new Promise(async (resolve) => {
    // Selector fallback lists - Substack sometimes changes class names
    const COMPOSE_TRIGGERS = [
      '[data-testid="compose-note-button"]',
      '[data-testid="new-note-button"]',
      'button[aria-label*="note" i]',
      'button[aria-label*="compose" i]',
      '.compose-button',
      '[class*="composeButton"]',
      '[class*="compose-button"]',
    ];

    const EDITORS = [
      '.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][class*="editor"]',
      'div[contenteditable="true"]',
    ];

    const POST_BUTTON_TEXTS = ['post', 'publish', 'share'];

    function findElement(selectors) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    }

    function findPostButton() {
      // Try data-testid first
      const byTestId = document.querySelector(
        '[data-testid="post-button"], [data-testid="publish-button"]'
      );
      if (byTestId) return byTestId;

      // Find by button text
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase();
        if (POST_BUTTON_TEXTS.includes(text) && !btn.disabled) return btn;
      }
      return null;
    }

    function sleep(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function setEditorText(editor, text) {
      editor.focus();
      // Select all existing content and replace it
      document.execCommand('selectAll', false, null);
      await sleep(50);
      // insertText dispatches InputEvent which ProseMirror/Tiptap handles
      const inserted = document.execCommand('insertText', false, text);
      if (!inserted || editor.textContent.trim() !== text.trim()) {
        // Fallback: clipboard approach
        try {
          await navigator.clipboard.writeText(text);
          document.execCommand('selectAll', false, null);
          document.execCommand('paste');
        } catch (_) {
          // Last resort: direct innerHTML (loses formatting but gets text in)
          editor.innerText = text;
          editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
      }
    }

    // Navigate to the notes page if not already there
    if (!window.location.pathname.startsWith('/notes')) {
      window.location.href = 'https://substack.com/notes';
      // The page will reload; this function will need to be re-injected.
      // Signal the background to retry after navigation.
      resolve({ success: false, error: 'navigating', retry: true });
      return;
    }

    // Wait for compose area to appear (up to 8s)
    let composeTrigger = null;
    for (let i = 0; i < 40; i++) {
      composeTrigger = findElement(COMPOSE_TRIGGERS);
      if (composeTrigger) break;
      await sleep(200);
    }

    // If there's a trigger button, click it to expand the composer
    if (composeTrigger) {
      composeTrigger.click();
      await sleep(400);
    }

    // Find the editor
    let editor = null;
    for (let i = 0; i < 20; i++) {
      editor = findElement(EDITORS);
      if (editor) break;
      await sleep(200);
    }

    if (!editor) {
      resolve({ success: false, error: 'Could not find the note editor. Substack UI may have changed.' });
      return;
    }

    await setEditorText(editor, note.text);
    await sleep(300);

    // Find and click the Post button
    const postBtn = findPostButton();
    if (!postBtn) {
      resolve({ success: false, error: 'Could not find the Post button. Substack UI may have changed.' });
      return;
    }

    postBtn.click();
    await sleep(500);

    resolve({ success: true });
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

function notifyUser(title, message) {
  chrome.notifications?.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title,
    message,
  });
}

// ---------------------------------------------------------------------------
// Message listener - handles alarm registration and status queries
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'SCHEDULE_NOTE') {
    const { note } = msg;
    saveNoteAndAlarm(note).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'GET_PENDING_COUNT') {
    getAllNotes().then((notes) => {
      const pending = Object.values(notes).filter((n) => n.status === 'pending').length;
      sendResponse({ count: pending });
    });
    return true;
  }
});

async function saveNoteAndAlarm(note) {
  // Persist note
  const result = await chrome.storage.local.get('scheduledNotes');
  const notes = result.scheduledNotes || {};
  notes[note.id] = note;
  await chrome.storage.local.set({ scheduledNotes: notes });

  // Register alarm - minimum delay Chrome allows is 30s
  const when = Math.max(note.scheduledTime, Date.now() + 30000);
  chrome.alarms.create(note.id, { when });
}
