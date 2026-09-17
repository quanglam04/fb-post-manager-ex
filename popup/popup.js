/**
 * FB Manager — popup/popup.js
 */

const statusRow  = document.getElementById("status-row");
const statusText = document.getElementById("status-text");
const btnOpen    = document.getElementById("btn-open-dashboard");

// Kiểm tra xem Facebook có đang mở không
async function checkFbTab() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "CHECK_FB_TAB" }, (resp) => {
      if (chrome.runtime.lastError) return resolve(false);
      resolve(resp?.found || false);
    });
  });
}

// Mở dashboard (hoặc focus nếu đã mở)
async function openDashboard(section = null) {
  const url = chrome.runtime.getURL("dashboard/index.html") + (section ? `#${section}` : "");
  // Tìm xem dashboard đã mở chưa
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL("dashboard/index.html") });
  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    if (section) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "NAVIGATE", section });
    }
    window.close();
  } else {
    chrome.tabs.create({ url });
    window.close();
  }
}

// Init
(async () => {
  const hasFb = await checkFbTab();

  if (hasFb) {
    statusRow.className = "status-row ok";
    const dot = document.createElement("div");
    dot.className = "status-dot";
    statusRow.innerHTML = "";
    statusRow.appendChild(dot);
    const txt = document.createElement("span");
    txt.textContent = "Facebook đang mở ✓";
    statusRow.appendChild(txt);
  } else {
    statusRow.className = "status-row warn";
    statusRow.innerHTML = `<div class="status-dot"></div><span>Chưa mở Facebook ⚠️</span>`;
  }

  // Button listeners
  btnOpen.addEventListener("click", () => openDashboard());

  document.querySelectorAll(".quick-link").forEach(btn => {
    btn.addEventListener("click", () => openDashboard(btn.dataset.section));
  });

  document.getElementById("reloadBtn")?.addEventListener("click", () => {
    chrome.runtime.reload();
    window.close();
  });
})();
