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

const PLATFORM_CONFIGS = [
  {
    id: 'chatgpt',
    hostPattern: /(^|\.)chatgpt\.com$/,
    userMessageSelector: '[data-message-author-role="user"]',
    getBubble: (node) => node.querySelector('.user-message-bubble-color') ?? node,
    getMessageId: (node) => node.getAttribute('data-message-id'),
    getScrollTarget: (node) => node.closest('article') ?? node,
    describe: 'ChatGPT web client'
  },
  {
    id: 'claude',
    hostPattern: /(^|\.)claude\.ai$/,
    userMessageSelector: '[data-testid="user-message"]',
    getBubble: (node) => node.closest('.group') ?? node,
    getMessageId: (node) => node.closest('[data-message-id]')?.getAttribute('data-message-id'),
    getScrollTarget: (node) => node.closest('.group') ?? node,
    describe: 'Claude web client'
  },
  {
    // Google AI Studio (aistudio.google.com) platform configuration.
    // IMPORTANT: AI Studio uses virtual scrolling - content is removed from DOM
    // when scrolled out of view. We need special handling for this.
    id: 'google-ai-studio',
    hostPattern: /(^|\.)aistudio\.google\.com$/,
    // Select all user prompt containers (even if content is virtualized).
    userMessageSelector: '[data-turn-role="User"]',
    // Get the turn-content div for highlighting.
    getBubble: (node) => node.querySelector('.turn-content') ?? node,
    // Extract the turn ID from the parent ms-chat-turn element.
    getMessageId: (node) => node.closest('ms-chat-turn')?.getAttribute('id'),
    // Scroll to the parent ms-chat-turn element for proper positioning.
    getScrollTarget: (node) => node.closest('ms-chat-turn') ?? node,
    // Flag indicating this platform uses virtual scrolling.
    usesVirtualScroll: true,
    // Custom text extraction for Google AI Studio.
    // Returns empty string if content is virtualized (not in DOM).
    extractText: (node) => {
      // Try 1: Look for user-specific cmark node (most reliable for user messages).
      const userCmarkNode = node.querySelector('.cmark-node.user-chunk');
      if (userCmarkNode) {
        return userCmarkNode.textContent?.trim() ?? '';
      }

      // Try 2: Look for ms-text-chunk element.
      const textChunk = node.querySelector('ms-text-chunk');
      if (textChunk) {
        return textChunk.textContent?.trim() ?? '';
      }

      // Try 3: Look for .text-chunk class (on ms-prompt-chunk).
      const promptChunk = node.querySelector('.text-chunk');
      if (promptChunk) {
        return promptChunk.textContent?.trim() ?? '';
      }

      // Try 4: Look for any cmark-node element.
      const cmarkNode = node.querySelector('.cmark-node');
      if (cmarkNode) {
        return cmarkNode.textContent?.trim() ?? '';
      }

      // Try 5: Get turn-content but exclude the author label.
      const turnContent = node.querySelector('.turn-content');
      if (turnContent) {
        // Clone to avoid modifying the DOM.
        const clone = turnContent.cloneNode(true);
        // Remove author label from clone.
        const authorLabel = clone.querySelector('.author-label');
        if (authorLabel) {
          authorLabel.remove();
        }
        const text = clone.textContent?.trim() ?? '';
        // Return text only if it's not just whitespace/comments.
        if (text.length > 0) {
          return text;
        }
      }

      // Content is likely virtualized - return empty string.
      return '';
    },
    describe: 'Google AI Studio web client'
  },
  {
    id: 'gemini',
    hostPattern: /(^|\.)gemini\.google\.com$/,
    // Select the user-query element.
    userMessageSelector: 'user-query',
    // Highlighting the specific bubble element.
    getBubble: (node) => node.querySelector('.user-query-bubble-with-background') ?? node,
    // Get the ID from the conversation container.
    getMessageId: (node) => node.closest('.conversation-container')?.id,
    // Scroll to the container.
    getScrollTarget: (node) => node.closest('.conversation-container') ?? node,
    describe: 'Google Gemini web client'
  }
];

const ACTIVE_PLATFORM = PLATFORM_CONFIGS.find((config) => config.hostPattern.test(window.location.hostname));
console.log('[ChatGPT Sidebar] Initializing...', window.location.hostname);
console.log('[ChatGPT Sidebar] Active Platform:', ACTIVE_PLATFORM);

const sidebarState = {
  active: false,
  sidebarEl: null,
  observer: null,
  scrollHandler: null,       // For virtual scroll platforms.
  refreshDebounceTimer: null, // Debounce sidebar refreshes.
  textCache: new Map()       // Cache extracted text by message ID (for virtual scroll).
};

// Debounce delay for scroll-triggered refreshes (ms).
const SCROLL_REFRESH_DELAY = 150;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === TOGGLE_CMD) {
    console.log('[ChatGPT Sidebar] Toggle command received');
    if (!ACTIVE_PLATFORM) {
      console.warn('ChatGPT Sidebar Navigator: unsupported host, ignoring toggle.');
      sendResponse({ active: false, unsupported: true });
      return;
    }

    sidebarState.active ? deactivateSidebar() : activateSidebar();
    sendResponse({ active: sidebarState.active });
  }
});

function activateSidebar() {
  if (!document?.body) {
    return;
  }

  sidebarState.active = true;
  ensureSidebar();
  highlightExistingQuestions();
  monitorNewMessages();
  // For platforms with virtual scrolling, refresh sidebar on scroll.
  if (ACTIVE_PLATFORM?.usesVirtualScroll) {
    monitorScroll();
  }
  document.body.classList.add(BODY_ACTIVE_CLASS);
}

function deactivateSidebar() {
  sidebarState.active = false;
  removeSidebar();
  removeHighlights();
  disconnectObserver();
  disconnectScrollHandler();
  sidebarState.textCache.clear(); // Clear cached text for virtual scroll platforms.
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

  // Track how many messages have text (for virtual scroll platforms).
  let messagesWithText = 0;
  const usesVirtualScroll = ACTIVE_PLATFORM?.usesVirtualScroll ?? false;

  userMessages.forEach((message, index) => {
    const messageId = getMessageId(message, index) ?? `question-${index}`;
    let questionText = extractQuestionText(message);

    // For virtual scroll platforms, use cached text if current extraction failed.
    if (usesVirtualScroll) {
      if (questionText) {
        // Update cache with newly extracted text.
        sidebarState.textCache.set(messageId, questionText);
      } else {
        // Try to use cached text.
        questionText = sidebarState.textCache.get(messageId) ?? '';
      }
    }

    // Skip messages with no text (unless it's a virtual scroll platform showing placeholders).
    if (!questionText) {
      if (usesVirtualScroll) {
        // Show placeholder for virtualized messages - clicking will scroll to reveal.
        const listItem = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'question-link virtualized';
        button.dataset.messageId = messageId;
        button.textContent = `${index + 1}. (scroll to load...)`;
        button.style.opacity = '0.6';
        button.style.fontStyle = 'italic';

        button.addEventListener('click', () => {
          scrollToMessage(message);
          // After scrolling, refresh to pick up the content.
          setTimeout(() => {
            refreshSidebarList();
            highlightExistingQuestions();
          }, 300);
        });

        listItem.appendChild(button);
        list.appendChild(listItem);
      }
      return;
    }

    messagesWithText++;
    const listItem = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'question-link';
    button.dataset.messageId = messageId;
    button.textContent = `${index + 1}. ${questionText}`;

    button.addEventListener('click', () => {
      scrollToMessage(message);
      flashMessage(message);
    });

    listItem.appendChild(button);
    list.appendChild(listItem);
  });

  // For virtual scroll platforms, show hint if some messages are not loaded.
  if (usesVirtualScroll && messagesWithText < userMessages.length && messagesWithText > 0) {
    const hint = document.createElement('p');
    hint.textContent = 'Scroll through chat to load all questions.';
    hint.style.padding = '8px 16px';
    hint.style.fontSize = '11px';
    hint.style.opacity = '0.7';
    hint.style.fontStyle = 'italic';
    hint.style.borderTop = '1px solid rgba(148, 163, 184, 0.2)';
    hint.style.marginTop = '8px';
    list.appendChild(hint);
  }
}

function highlightExistingQuestions() {
  getUserMessages().forEach((message) => highlightMessage(message));
}

function highlightMessage(message) {
  const bubble = getBubbleForMessage(message);
  bubble?.classList.add(HIGHLIGHT_CLASS);
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

/**
 * Monitor scroll events to refresh sidebar when virtualized content loads.
 * Google AI Studio uses virtual scrolling - content only exists in DOM when visible.
 */
function monitorScroll() {
  if (sidebarState.scrollHandler) {
    return;
  }

  sidebarState.scrollHandler = () => {
    // Debounce to avoid excessive refreshes during scroll.
    if (sidebarState.refreshDebounceTimer) {
      clearTimeout(sidebarState.refreshDebounceTimer);
    }
    sidebarState.refreshDebounceTimer = setTimeout(() => {
      refreshSidebarList();
      highlightExistingQuestions();
    }, SCROLL_REFRESH_DELAY);
  };

  // Listen on document for scroll events (captures all scrollable containers).
  document.addEventListener('scroll', sidebarState.scrollHandler, true);
}

/**
 * Remove scroll event listener.
 */
function disconnectScrollHandler() {
  if (sidebarState.scrollHandler) {
    document.removeEventListener('scroll', sidebarState.scrollHandler, true);
    sidebarState.scrollHandler = null;
  }
  if (sidebarState.refreshDebounceTimer) {
    clearTimeout(sidebarState.refreshDebounceTimer);
    sidebarState.refreshDebounceTimer = null;
  }
}

function handlePotentialMessage(node) {
  if (!ACTIVE_PLATFORM) {
    return;
  }

  if (node.matches?.(ACTIVE_PLATFORM.userMessageSelector)) {
    highlightMessage(node);
    refreshSidebarList();
    return;
  }

  const nestedCandidate = node.querySelector?.(ACTIVE_PLATFORM.userMessageSelector);
  if (nestedCandidate) {
    highlightMessage(nestedCandidate);
    refreshSidebarList();
  }
}

function getUserMessages() {
  if (!ACTIVE_PLATFORM) {
    return [];
  }
  return Array.from(document.querySelectorAll(ACTIVE_PLATFORM.userMessageSelector));
}

function extractQuestionText(message) {
  // Use platform-specific text extraction if available (e.g., Google AI Studio).
  // This allows platforms to exclude unwanted elements like "thoughts" sections.
  let rawText;
  if (ACTIVE_PLATFORM?.extractText) {
    rawText = ACTIVE_PLATFORM.extractText(message);
  } else {
    rawText = message.textContent?.trim();
  }

  if (!rawText) {
    return '';
  }

  // Normalize whitespace and truncate long messages for display in sidebar.
  const sanitized = rawText.replace(/\s+/g, ' ');
  return sanitized.length > 140 ? `${sanitized.slice(0, 137)}…` : sanitized;
}

function getMessageId(message, index) {
  return ACTIVE_PLATFORM?.getMessageId?.(message, index) ?? message.getAttribute?.('data-message-id');
}

function scrollToMessage(message) {
  const target = ACTIVE_PLATFORM?.getScrollTarget?.(message) ?? message;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function flashMessage(message) {
  const bubble = getBubbleForMessage(message);
  if (!bubble) {
    return;
  }
  bubble.classList.add(FLASH_CLASS);
  setTimeout(() => bubble.classList.remove(FLASH_CLASS), 1600);
}

function removeSidebar() {
  sidebarState.sidebarEl?.remove();
  sidebarState.sidebarEl = null;
}

function getBubbleForMessage(message) {
  if (!message) {
    return null;
  }

  const resolved = ACTIVE_PLATFORM?.getBubble?.(message);
  if (resolved) {
    return resolved;
  }

  return message.querySelector?.('.user-message-bubble-color') || message;
}
