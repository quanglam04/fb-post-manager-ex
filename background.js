/**
 * FB Manager — background.js (Service Worker)
 * Nhiệm vụ: Message bridge giữa Dashboard và Content Script trên Facebook
 */

/**
 * Tìm tab Facebook đang mở
 */
async function findFacebookTab() {
  const tabs = await chrome.tabs.query({ url: "https://www.facebook.com/*" });
  // Ưu tiên tab đang active, nếu không có thì lấy tab đầu tiên
  const activeTab = tabs.find((t) => t.active);
  return activeTab || tabs[0] || null;
}

/**
 * Forward message từ Dashboard → Content Script
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FB_ACTION") {
    handleFbAction(msg, sendResponse);
    return true; // Giữ channel mở cho async response
  }

  if (msg.type === "CHECK_FB_TAB") {
    findFacebookTab().then((tab) => {
      sendResponse({ found: !!tab, tabId: tab?.id || null });
    });
    return true;
  }
});

async function handleFbAction(msg, sendResponse) {
  try {
    const fbTab = await findFacebookTab();

    if (!fbTab) {
      sendResponse({
        success: false,
        error:
          "Hãy mở Facebook trong một tab khác trước khi sử dụng tính năng này.",
      });
      return;
    }

    // Đảm bảo content script đã được inject
    try {
      await chrome.scripting.executeScript({
        target: { tabId: fbTab.id },
        files: ["content/facebook.js"],
      });
    } catch (_) {
      // Content script có thể đã được inject, bỏ qua lỗi
    }

    // Forward message đến content script
    chrome.tabs.sendMessage(fbTab.id, msg, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          success: false,
          error:
            "Không thể kết nối đến Facebook tab. Hãy thử reload trang Facebook.",
        });
      } else {
        sendResponse(response);
      }
    });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}
