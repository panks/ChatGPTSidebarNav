const CHAT_HOST = 'chatgpt.com';
const TOGGLE_CMD = 'CHATGPT_HELPER_TOGGLE';

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#1d4ed8' });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) {
    return;
  }

  if (!tab.url.includes(CHAT_HOST)) {
    chrome.action.setBadgeText({ text: '!', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: TOGGLE_CMD });
    updateBadge(tab.id, response?.active === true);
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['contentScript.js']
      });
      const response = await chrome.tabs.sendMessage(tab.id, { type: TOGGLE_CMD });
      updateBadge(tab.id, response?.active === true);
    } catch (injectionError) {
      console.error('ChatGPT Sidebar Navigator: unable to inject content script', injectionError);
      chrome.action.setBadgeText({ text: 'X', tabId: tab.id });
      setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
    }
  }
});

function updateBadge(tabId, isActive) {
  chrome.action.setBadgeText({ text: isActive ? 'ON' : '', tabId });
}
