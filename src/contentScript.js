/*
 * ChatGPT Sidebar Navigator content script.
 * Responsibilities:
 *   1. Highlight user questions in-place for quick scanning.
 *   2. Provide a collapsible in-page sidebar listing every user question.
 *   3. Scroll the page to the selected question when a list item is clicked.
 * The script stays idle until the browser action tells it to toggle on.
 */

const TOGGLE_CMD = 'CHATGPT_HELPER_TOGGLE';
const SIDEBAR_ID = 'chatgpt-question-sidebar';
const HIGHLIGHT_CLASS = 'chatgpt-question-highlight';
const FLASH_CLASS = 'chatgpt-question-flash';
const BODY_ACTIVE_CLASS = 'chatgpt-question-sidebar-active';

const sidebarState = {
  active: false,
  sidebarEl: null,
  observer: null
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === TOGGLE_CMD) {
    sidebarState.active ? deactivateSidebar() : activateSidebar();
    sendResponse({ active: sidebarState.active });
  }
});

function activateSidebar() {
  sidebarState.active = true;
  ensureSidebar();
  highlightExistingQuestions();
  monitorNewMessages();
  document.body.classList.add(BODY_ACTIVE_CLASS);
}

function deactivateSidebar() {
  sidebarState.active = false;
  removeSidebar();
  removeHighlights();
  disconnectObserver();
  document.body.classList.remove(BODY_ACTIVE_CLASS);
}

function ensureSidebar() {
  if (document.getElementById(SIDEBAR_ID)) {
    sidebarState.sidebarEl = document.getElementById(SIDEBAR_ID);
    refreshSidebarList();
    return;
  }

  const container = document.createElement('aside');
  container.id = SIDEBAR_ID;
  container.setAttribute('role', 'complementary');
  container.setAttribute('aria-label', 'ChatGPT questions sidebar');
  container.innerHTML = getSidebarTemplate();

  document.body.appendChild(container);
  sidebarState.sidebarEl = container;

  wireSidebarInteractions();
  refreshSidebarList();
}

function getSidebarTemplate() {
  return `
    <header>
      <h1>My Questions</h1>
      <button type="button" class="sidebar-toggle" aria-expanded="true">Collapse</button>
    </header>
    <div class="sidebar-body">
      <ul class="question-list" aria-live="polite"></ul>
    </div>
    <div class="sidebar-footer">Click any question to scroll back.</div>
  `;
}

function wireSidebarInteractions() {
  if (!sidebarState.sidebarEl) {
    return;
  }

  const toggleButton = sidebarState.sidebarEl.querySelector('button.sidebar-toggle');
  toggleButton?.addEventListener('click', () => {
    sidebarState.sidebarEl?.classList.toggle('collapsed');
    const collapsed = sidebarState.sidebarEl?.classList.contains('collapsed');
    toggleButton.textContent = collapsed ? 'Expand' : 'Collapse';
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
  });
}

function refreshSidebarList() {
  if (!sidebarState.sidebarEl) {
    return;
  }

  const list = sidebarState.sidebarEl.querySelector('.question-list');
  if (!list) {
    return;
  }

  list.innerHTML = '';

  const userMessages = getUserMessages();
  if (!userMessages.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Your questions will show up here.';
    empty.style.padding = '0 16px';
    empty.style.fontSize = '13px';
    empty.style.opacity = '0.8';
    list.appendChild(empty);
    return;
  }

  userMessages.forEach((message, index) => {
    const questionText = extractQuestionText(message);
    if (!questionText) {
      return;
    }

    const listItem = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'question-link';
    button.dataset.messageId = getMessageId(message) ?? `question-${index}`;
    button.textContent = `${index + 1}. ${questionText}`;

    button.addEventListener('click', () => {
      scrollToMessage(message);
      flashMessage(message);
    });

    listItem.appendChild(button);
    list.appendChild(listItem);
  });
}

function highlightExistingQuestions() {
  getUserMessages().forEach((message) => highlightMessage(message));
}

function highlightMessage(message) {
  const bubble = message.querySelector('.user-message-bubble-color') || message;
  bubble.classList.add(HIGHLIGHT_CLASS);
}

function removeHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
    node.classList.remove(HIGHLIGHT_CLASS);
  });
}

function monitorNewMessages() {
  if (sidebarState.observer) {
    return;
  }

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) {
          return;
        }
        handlePotentialMessage(node);
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  sidebarState.observer = observer;
}

function disconnectObserver() {
  sidebarState.observer?.disconnect();
  sidebarState.observer = null;
}

function handlePotentialMessage(node) {
  if (node.matches?.('[data-message-author-role="user"]')) {
    highlightMessage(node);
    refreshSidebarList();
    return;
  }

  const nestedCandidate = node.querySelector?.('[data-message-author-role="user"]');
  if (nestedCandidate) {
    highlightMessage(nestedCandidate);
    refreshSidebarList();
  }
}

function getUserMessages() {
  return Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
}

function extractQuestionText(message) {
  const rawText = message.textContent?.trim();
  if (!rawText) {
    return '';
  }

  const sanitized = rawText.replace(/\s+/g, ' ');
  return sanitized.length > 140 ? `${sanitized.slice(0, 137)}…` : sanitized;
}

function getMessageId(message) {
  return message.getAttribute('data-message-id');
}

function scrollToMessage(message) {
  message.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function flashMessage(message) {
  const bubble = message.querySelector('.user-message-bubble-color') || message;
  bubble.classList.add(FLASH_CLASS);
  setTimeout(() => bubble.classList.remove(FLASH_CLASS), 1600);
}

function removeSidebar() {
  sidebarState.sidebarEl?.remove();
  sidebarState.sidebarEl = null;
}
