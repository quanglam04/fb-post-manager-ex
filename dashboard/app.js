/**
 * FB Manager — dashboard/app.js
 * Full UI logic, routing, state management, API communication
 */

"use strict";

/* ================================================================
   STATE
   ================================================================ */
const STATE = {
  activeSection: "home",

  posts: {
    data:     [],
    filtered: [],
    selected: new Set(),
    loading:  false,
    cursor:   null,
    fetchedAt: null,
  },

  groups: {
    data:     [],
    filtered: [],
    selected: new Set(),
    loading:  false,
    cursor:   null,
    fetchedAt: null,
  },

  friends: {
    data:     [],
    filtered: [],
    selected: new Set(),
    loading:  false,
    cursor:   null,
    fetchedAt: null,
  },

  filters: {
    posts: {
      yearFrom: 2020,
      yearTo:   new Date().getFullYear(),
      privacy:  "ALL",
    },
    groups: {
      search:       "",
      inactiveSince: "ALL",
    },
    friends: {
      search:          "",
      mutualLessThan:  "ALL",
      addedFrom:       "ALL",
    },
  },

  bulkAction: {
    running:      false,
    paused:       false,
    current:      0,
    total:        0,
    nextActionIn: 0,
    results:      { success: 0, failed: 0 },
    cancelFn:     null,
    pauseFn:      null,
    resumeFn:     null,
    countdownInterval: null,
  },

  settings: {
    delay_min_ms:  1000,
    delay_max_ms:  3000,
    delay_jitter:  true,
    items_per_page: 20,
  },

  fbConnected: false,
  fbUserId:    null,
  fbUserName:  null,
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/* ================================================================
   UTILITIES
   ================================================================ */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay(config) {
  const base   = Math.random() * (config.delay_max_ms - config.delay_min_ms) + config.delay_min_ms;
  const jitter = config.delay_jitter ? (Math.random() - 0.5) * 400 : 0;
  return Math.round(base + jitter);
}

function formatDate(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d)) return "—";
  const dd   = String(d.getDate()).padStart(2, "0");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatDatetime(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  if (isNaN(d)) return "—";
  const dd   = String(d.getDate()).padStart(2, "0");
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh   = String(d.getHours()).padStart(2, "0");
  const min  = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isStale(fetchedAt) {
  if (!fetchedAt) return false;
  return Date.now() - fetchedAt > CACHE_TTL_MS;
}

/* ================================================================
   API — Communication with Background / Content Script
   ================================================================ */
const API = {
  send(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FB_ACTION", action, payload },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!resp) {
            reject(new Error("Không nhận được phản hồi từ extension."));
            return;
          }
          if (!resp.success) {
            const err = new Error(resp.error || "Unknown error");
            err.rateLimited = resp.rateLimited;
            reject(err);
            return;
          }
          resolve(resp);
        }
      );
    });
  },

  async checkFbTab() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "CHECK_FB_TAB" }, (resp) => {
        if (chrome.runtime.lastError) return resolve({ found: false });
        resolve(resp || { found: false });
      });
    });
  },

  async fetchPosts(yearFrom, yearTo, privacy, cursor = null) {
    return this.send("FETCH_POSTS", { yearFrom, yearTo, privacy, cursor });
  },

  async deletePost(storyId) {
    return this.send("DELETE_POST", { storyId });
  },

  async setPrivacy(storyId, privacy) {
    return this.send("SET_PRIVACY", { storyId, privacy });
  },

  async fetchGroups(cursor = null) {
    return this.send("FETCH_GROUPS", { cursor });
  },

  async leaveGroup(groupId) {
    return this.send("LEAVE_GROUP", { groupId });
  },

  async fetchFriends(cursor = null) {
    return this.send("FETCH_FRIENDS", { cursor });
  },

  async unfriend(friendId) {
    return this.send("UNFRIEND", { friendId });
  },
};

/* ================================================================
   TOAST
   ================================================================ */
function showToast(message, type = "success", duration = 4000) {
  const icons = { success: "✓", error: "✕", warning: "⚠", info: "ℹ" };
  const container = document.getElementById("toast-container");

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ"}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" aria-label="Đóng">×</button>
  `;

  toast.querySelector(".toast-close").addEventListener("click", () => removeToast(toast));
  container.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
}

function removeToast(toast) {
  toast.classList.add("hiding");
  setTimeout(() => toast.remove(), 220);
}

/* ================================================================
   CONFIRM DIALOG
   ================================================================ */
function showConfirm(title, desc, onConfirm) {
  const overlay = document.createElement("div");
  overlay.className = "dialog-overlay";
  overlay.innerHTML = `
    <div class="dialog" role="dialog" aria-modal="true">
      <div class="dialog-icon">⚠️</div>
      <div class="dialog-title">${escapeHtml(title)}</div>
      <div class="dialog-desc">${escapeHtml(desc)}</div>
      <div class="dialog-actions">
        <button class="btn btn-ghost" id="dlg-cancel">Hủy</button>
        <button class="btn btn-danger" id="dlg-confirm">Xác nhận</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector("#dlg-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#dlg-confirm").addEventListener("click", () => {
    overlay.remove();
    onConfirm();
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

/* ================================================================
   ROUTER
   ================================================================ */
function navigate(section) {
  STATE.activeSection = section;

  // Update nav items
  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.section === section);
  });

  // Render section
  const root = document.getElementById("section-root");
  switch (section) {
    case "home":    renderHome(root);    break;
    case "posts":   renderPosts(root);   break;
    case "groups":  renderGroups(root);  break;
    case "friends": renderFriends(root); break;
    default:        renderHome(root);
  }

  // Update URL hash
  history.replaceState(null, "", `#${section}`);
}

/* ================================================================
   COMPONENTS
   ================================================================ */

// ── Privacy Badge ───────────────────────────────────────────────
function privacyBadge(privacy) {
  const map = {
    PUBLIC:  { cls: "badge-public",  icon: "🌐", label: "Công khai" },
    FRIENDS: { cls: "badge-friends", icon: "👥", label: "Bạn bè" },
    ONLY_ME: { cls: "badge-only-me", icon: "🔒", label: "Chỉ mình tôi" },
    SELF:    { cls: "badge-only-me", icon: "🔒", label: "Chỉ mình tôi" },
  };
  const info = map[privacy] || { cls: "badge-friends", icon: "👥", label: privacy || "Bạn bè" };
  return `<span class="badge ${info.cls}">${info.icon} ${info.label}</span>`;
}

// ── Bulk Action Runner ───────────────────────────────────────────
async function runBulkAction(items, actionFn, onProgress) {
  let paused    = false;
  let cancelled = false;

  STATE.bulkAction.running  = true;
  STATE.bulkAction.paused   = false;
  STATE.bulkAction.current  = 0;
  STATE.bulkAction.total    = items.length;
  STATE.bulkAction.results  = { success: 0, failed: 0 };

  STATE.bulkAction.cancelFn = () => { cancelled = true; };
  STATE.bulkAction.pauseFn  = () => { paused = true;    STATE.bulkAction.paused = true;  };
  STATE.bulkAction.resumeFn = () => { paused = false;   STATE.bulkAction.paused = false; };

  for (let i = 0; i < items.length; i++) {
    if (cancelled) break;
    while (paused && !cancelled) await sleep(200);
    if (cancelled) break;

    try {
      await actionFn(items[i]);
      STATE.bulkAction.results.success++;
    } catch (err) {
      STATE.bulkAction.results.failed++;
      console.error(`[FB Manager] Action failed:`, err);

      // Rate limit detected → slow down
      if (err.rateLimited) {
        showToast("⚠️ Facebook đang giới hạn tốc độ. Đang tăng delay...", "warning");
        STATE.settings.delay_min_ms = Math.min(STATE.settings.delay_min_ms * 2, 10000);
        STATE.settings.delay_max_ms = Math.min(STATE.settings.delay_max_ms * 2, 15000);
      }
    }

    STATE.bulkAction.current = i + 1;
    onProgress({ current: i + 1, total: items.length, results: STATE.bulkAction.results });

    if (i < items.length - 1 && !cancelled) {
      const delay = getRandomDelay(STATE.settings);
      STATE.bulkAction.nextActionIn = delay;
      onProgress({ current: i + 1, total: items.length, results: STATE.bulkAction.results, nextActionIn: delay });

      const start = Date.now();
      while (Date.now() - start < delay) {
        if (cancelled) break;
        while (paused && !cancelled) await sleep(200);
        const remaining = delay - (Date.now() - start);
        if (remaining > 0) {
          STATE.bulkAction.nextActionIn = remaining;
          onProgress({ current: i + 1, total: items.length, results: STATE.bulkAction.results, nextActionIn: remaining });
          await sleep(Math.min(100, remaining));
        }
      }
    }
  }

  STATE.bulkAction.running = false;
  STATE.bulkAction.paused  = false;
  STATE.bulkAction.cancelFn = null;

  return { ...STATE.bulkAction.results, cancelled };
}

// ── Progress Card ────────────────────────────────────────────────
function renderProgressCard(containerId) {
  const { current, total, results, nextActionIn, paused } = STATE.bulkAction;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;

  let container = document.getElementById(containerId);
  if (!container) return;

  const existing = container.querySelector(".progress-card");

  const html = `
    <div class="progress-card" id="progress-card-inner">
      <div class="progress-header">
        <div class="progress-title">
          <div class="spinner spinner-sm"></div>
          Đang xử lý...
        </div>
        <div class="progress-controls">
          <button class="btn btn-ghost btn-sm" id="btn-progress-pause">
            ${paused ? "▶ Tiếp tục" : "⏸ Tạm dừng"}
          </button>
          <button class="btn btn-danger btn-sm" id="btn-progress-cancel">✕ Hủy</button>
        </div>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-fill" style="width: ${pct}%"></div>
      </div>
      <div class="progress-stats">
        <div class="progress-text">
          <strong>${current} / ${total}</strong> bài đã xử lý
          · ✓ ${results.success} thành công
          · ✕ ${results.failed} lỗi
        </div>
        <div class="progress-countdown">
          ${nextActionIn > 0 ? `Chờ <strong>${(nextActionIn / 1000).toFixed(1)}s</strong> tiếp theo...` : ""}
        </div>
      </div>
    </div>
  `;

  if (existing) {
    existing.outerHTML = html;
  } else {
    container.insertAdjacentHTML("afterbegin", html);
  }

  // Bind controls
  const btnPause  = document.getElementById("btn-progress-pause");
  const btnCancel = document.getElementById("btn-progress-cancel");

  if (btnPause) {
    btnPause.addEventListener("click", () => {
      if (STATE.bulkAction.paused) {
        STATE.bulkAction.resumeFn?.();
      } else {
        STATE.bulkAction.pauseFn?.();
      }
    });
  }

  if (btnCancel) {
    btnCancel.addEventListener("click", () => {
      STATE.bulkAction.cancelFn?.();
    });
  }
}

function removeProgressCard(containerId) {
  const card = document.getElementById("progress-card-inner");
  if (card) card.closest(".progress-card").remove();
}

/* ================================================================
   HOME SECTION
   ================================================================ */
function renderHome(root) {
  const postsCount   = STATE.posts.data.length;
  const groupsCount  = STATE.groups.data.length;
  const friendsCount = STATE.friends.data.length;

  const publicPosts  = STATE.posts.data.filter(p => p.privacy === "PUBLIC").length;
  const friendPosts  = STATE.posts.data.filter(p => p.privacy === "FRIENDS").length;

  const oldestGroup = STATE.groups.data.reduce((oldest, g) => {
    if (!g.lastVisited) return oldest;
    const y = new Date(g.lastVisited).getFullYear();
    return y < oldest ? y : oldest;
  }, new Date().getFullYear());

  const avgMutual = friendsCount > 0
    ? Math.round(STATE.friends.data.reduce((sum, f) => sum + (f.mutualCount || 0), 0) / friendsCount)
    : 0;

  root.innerHTML = `
    <div class="section" id="home-section">
      <div class="breadcrumb">
        <span>FB Manager</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">Dashboard</span>
      </div>

      <div class="section-header">
        <div class="section-title-block">
          <h1 class="section-title">Dashboard</h1>
          <p class="section-desc">Xin chào! Tổng quan tài khoản Facebook của bạn.</p>
        </div>
      </div>

      ${STATE.fbConnected ? "" : `
        <div class="sim-banner">
          ℹ️ <strong>Chế độ Demo:</strong> Dữ liệu mẫu đang được hiển thị.
          Hãy mở Facebook và Fetch dữ liệu trong các section để thấy dữ liệu thực.
        </div>
      `}

      <!-- Stat Cards -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-icon-box accent">📝</div>
          <div class="stat-info">
            <div class="stat-num">${postsCount || "—"}</div>
            <div class="stat-label">Bài viết</div>
            <div class="stat-sub">${postsCount ? `${publicPosts} công khai · ${friendPosts} bạn bè` : "Chưa fetch"}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon-box blue">👥</div>
          <div class="stat-info">
            <div class="stat-num">${groupsCount || "—"}</div>
            <div class="stat-label">Nhóm tham gia</div>
            <div class="stat-sub">${groupsCount ? `Lâu nhất từ năm ${oldestGroup}` : "Chưa fetch"}</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-icon-box danger">❤️</div>
          <div class="stat-info">
            <div class="stat-num">${friendsCount || "—"}</div>
            <div class="stat-label">Bạn bè</div>
            <div class="stat-sub">${friendsCount ? `${avgMutual} bạn chung trung bình` : "Chưa fetch"}</div>
          </div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="quick-actions-card">
        <div class="quick-actions-label">Truy cập nhanh</div>
        <div class="quick-actions-btns">
          <button class="quick-action-btn" onclick="navigate('posts')">
            📝 My Posts
          </button>
          <button class="quick-action-btn" onclick="navigate('groups')">
            👥 Joined Groups
          </button>
          <button class="quick-action-btn" onclick="navigate('friends')">
            ❤️ Friends
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ================================================================
   POSTS SECTION
   ================================================================ */
function renderPosts(root) {
  const { data, filtered, selected, loading, cursor, fetchedAt } = STATE.posts;
  const { yearFrom, yearTo, privacy } = STATE.filters.posts;
  const currentYear = new Date().getFullYear();

  // Build year options
  const years = [];
  for (let y = currentYear; y >= 2004; y--) years.push(y);
  const yearFromOpts = years.map(y => `<option value="${y}" ${y === yearFrom ? "selected" : ""}>${y}</option>`).join("");
  const yearToOpts   = years.map(y => `<option value="${y}" ${y === yearTo   ? "selected" : ""}>${y}</option>`).join("");

  const privacyOpts = [
    { val: "ALL",     label: "Tất cả" },
    { val: "PUBLIC",  label: "Công khai" },
    { val: "FRIENDS", label: "Bạn bè" },
    { val: "ONLY_ME", label: "Chỉ mình tôi" },
  ].map(o => `<option value="${o.val}" ${o.val === privacy ? "selected" : ""}>${o.label}</option>`).join("");

  const selCount = selected.size;
  const stale = isStale(fetchedAt) && fetchedAt;

  root.innerHTML = `
    <div class="section" id="posts-section">
      <div class="breadcrumb">
        <span>FB Manager</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">My Posts</span>
      </div>

      <div class="section-header">
        <div class="section-title-block">
          <h1 class="section-title">My Posts</h1>
          <p class="section-desc">Quản lý các bài viết trên timeline của bạn.</p>
        </div>
        <div class="section-actions" id="posts-header-actions">
          ${selCount > 0 ? `
            <button class="btn btn-blue btn-sm" id="btn-bulk-private">🔒 Set Private (${selCount})</button>
            <button class="btn btn-danger btn-sm" id="btn-bulk-delete">🗑 Xóa (${selCount})</button>
          ` : ""}
          <button class="btn btn-ghost btn-sm" id="btn-posts-refresh">↻ Refresh</button>
          <button class="btn btn-primary btn-sm" id="btn-posts-fetch">⬇ Fetch Posts</button>
        </div>
      </div>

      ${stale ? `<div class="cache-banner"><span class="cache-banner-icon">⏱</span><span class="cache-banner-msg">Dữ liệu cũ — Refresh để cập nhật</span><button class="cache-banner-btn" id="btn-cache-refresh-posts">↻ Refresh</button></div>` : ""}

      <!-- Progress placeholder -->
      <div id="posts-progress-area"></div>

      <!-- Filter Bar -->
      <div class="filter-bar">
        <span class="filter-label">Từ năm</span>
        <select id="filter-year-from">${yearFromOpts}</select>
        <span class="filter-label">Đến năm</span>
        <select id="filter-year-to">${yearToOpts}</select>
        <span class="filter-label">Quyền riêng tư</span>
        <select id="filter-privacy">${privacyOpts}</select>
        <button class="btn btn-primary btn-sm" id="btn-apply-filter">🔍 Áp dụng</button>
      </div>

      <!-- Table -->
      <div class="table-wrap" id="posts-table-wrap">
        ${loading
          ? `<div class="loading-state"><div class="spinner"></div>Đang tải bài viết...</div>`
          : renderPostsTable(filtered, selected)
        }
      </div>
    </div>
  `;

  bindPostsEvents();
}

function renderPostsTable(posts, selected) {
  console.log("[APP] renderPostsTable:", posts?.length, "posts");
  if (posts.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-title">Chưa có bài viết</div>
        <div class="empty-desc">Nhấn "Fetch Posts" để tải danh sách bài viết từ Facebook.</div>
      </div>
    `;
  }

  const allSelected = posts.length > 0 && posts.every(p => selected.has(p.id));

  const rows = posts.map((post, i) => `
    <tr class="${selected.has(post.id) ? "selected" : ""}" data-id="${escapeHtml(post.id)}">
      <td><input type="checkbox" class="post-cb" data-id="${escapeHtml(post.id)}" ${selected.has(post.id) ? "checked" : ""}></td>
      <td class="cell-num">${i + 1}</td>
      <td class="cell-content" title="${escapeHtml(post.preview || post.content)}">
        ${post.isReshare ? '<span style="font-size:10px;color:var(--muted);margin-right:4px">🔁</span>' : ''}
        ${escapeHtml(post.preview || post.content)}
      </td>
      <td class="cell-date">${post.createdDate || formatDate(post.date)}</td>
      <td>${privacyBadge(post.privacy)}</td>
      <td class="cell-muted">${post.likes || 0}</td>
      <td class="cell-actions">
        <button class="btn-action btn-action-lock" data-action="lock" data-id="${escapeHtml(post.id)}" title="Set Private">🔒 Private</button>
        <button class="btn-action btn-action-danger" data-action="delete" data-id="${escapeHtml(post.id)}" title="Xóa">🗑 Xóa</button>
      </td>
    </tr>
  `).join("");

  const hasMore = STATE.posts.cursor !== null;

  return `
    <div class="table-top-bar">
      <div class="table-count">
        Hiển thị <strong>${posts.length}</strong> bài viết
        ${selected.size > 0 ? ` · <strong>${selected.size}</strong> đã chọn` : ""}
        ${STATE.posts.data.length > 0 && STATE.posts.data[0]?.simulated ? '<span class="stale-badge" style="margin-left:6px">Demo</span>' : ""}
      </div>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:40px"><input type="checkbox" id="cb-select-all-posts" ${allSelected ? "checked" : ""} title="Chọn tất cả"></th>
          <th style="width:50px">#</th>
          <th>Nội dung</th>
          <th style="width:120px">Ngày đăng</th>
          <th style="width:130px">Quyền riêng tư</th>
          <th style="width:80px">Lượt thích</th>
          <th style="width:180px">Thao tác</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${hasMore ? `
      <div class="load-more-row">
        <button class="btn btn-ghost" id="btn-load-more-posts">⬇ Tải thêm 20 bài</button>
      </div>
    ` : ""}
  `;
}

function refreshPostsTable() {
  const wrap = document.getElementById("posts-table-wrap");
  if (wrap) {
    wrap.innerHTML = renderPostsTable(STATE.posts.filtered, STATE.posts.selected);
  }
  bindPostsTableEvents();
  updatePostsHeaderActions();
}

function updatePostsHeaderActions() {
  const area = document.getElementById("posts-header-actions");
  if (!area) return;
  const selCount = STATE.posts.selected.size;
  const bulkHtml = selCount > 0 ? `
    <button class="btn btn-blue btn-sm" id="btn-bulk-private">🔒 Set Private (${selCount})</button>
    <button class="btn btn-danger btn-sm" id="btn-bulk-delete">🗑 Xóa (${selCount})</button>
  ` : "";
  area.innerHTML = bulkHtml + `
    <button class="btn btn-ghost btn-sm" id="btn-posts-refresh">↻ Refresh</button>
    <button class="btn btn-primary btn-sm" id="btn-posts-fetch">⬇ Fetch Posts</button>
  `;
  bindPostsHeaderEvents();
}

function bindPostsEvents() {
  bindPostsHeaderEvents();
  bindPostsTableEvents();
}

function bindPostsHeaderEvents() {
  document.getElementById("btn-posts-fetch")?.addEventListener("click", () => doFetchPosts(false));
  document.getElementById("btn-posts-refresh")?.addEventListener("click", () => doFetchPosts(false));
  document.getElementById("btn-cache-refresh-posts")?.addEventListener("click", () => doFetchPosts(false));
  document.getElementById("btn-apply-filter")?.addEventListener("click", applyPostsFilter);
  document.getElementById("btn-bulk-private")?.addEventListener("click", doBulkSetPrivate);
  document.getElementById("btn-bulk-delete")?.addEventListener("click", doBulkDeletePosts);
}

function bindPostsTableEvents() {
  // Select all checkbox
  const cbAll = document.getElementById("cb-select-all-posts");
  if (cbAll) {
    cbAll.addEventListener("change", () => {
      STATE.posts.filtered.forEach(p => {
        if (cbAll.checked) STATE.posts.selected.add(p.id);
        else               STATE.posts.selected.delete(p.id);
      });
      refreshPostsTable();
    });
  }

  // Row checkboxes
  document.querySelectorAll(".post-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) STATE.posts.selected.add(cb.dataset.id);
      else            STATE.posts.selected.delete(cb.dataset.id);
      const row = cb.closest("tr");
      if (row) row.classList.toggle("selected", cb.checked);
      updatePostsHeaderActions();
    });
  });

  // Action buttons
  document.querySelectorAll(".btn-action").forEach(btn => {
    btn.addEventListener("click", () => {
      const { action, id } = btn.dataset;
      if (action === "delete") doSingleDeletePost(id);
      if (action === "lock")   doSingleSetPrivate(id);
    });
  });

  // Load more
  document.getElementById("btn-load-more-posts")?.addEventListener("click", doLoadMorePosts);
}

// ── Filter ──────────────────────────────────────────────────────
function applyPostsFilter() {
  STATE.filters.posts.yearFrom = parseInt(document.getElementById("filter-year-from").value);
  STATE.filters.posts.yearTo   = parseInt(document.getElementById("filter-year-to").value);
  STATE.filters.posts.privacy  = document.getElementById("filter-privacy").value;

  // Re-fetch with new filter
  doFetchPosts();
}

// ── Fetch Posts ─────────────────────────────────────────────────
async function doFetchPosts(loadMore = false) {
  if (STATE.posts.loading) return;

  STATE.posts.loading = true;
  if (!loadMore) {
    STATE.posts.data     = [];
    STATE.posts.filtered = [];
    STATE.posts.selected = new Set();
    STATE.posts.cursor   = null;
  }

  // Show loading
  const wrap = document.getElementById("posts-table-wrap");
  if (wrap) wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div>Đang tải bài viết...</div>`;

  try {
    const { yearFrom, yearTo, privacy } = STATE.filters.posts;
    const resp = await API.fetchPosts(yearFrom, yearTo, privacy, loadMore ? STATE.posts.cursor : null);

    console.log("[APP] doFetchPosts resp:", resp);
    console.log("[APP] posts count:", resp?.posts?.length, "| first:", resp?.posts?.[0]);

    const newPosts = resp.posts || [];
    if (loadMore) {
      STATE.posts.data = [...STATE.posts.data, ...newPosts];
    } else {
      STATE.posts.data = newPosts;
    }
    STATE.posts.cursor    = resp.nextCursor || null;
    STATE.posts.filtered  = [...STATE.posts.data];
    STATE.posts.fetchedAt = Date.now();

    // Persist to storage
    chrome.storage.local.set({
      posts_cache: {
        data:      STATE.posts.data,
        fetchedAt: STATE.posts.fetchedAt,
        cursor:    STATE.posts.cursor,
      }
    });

    updateNavBadge("posts", STATE.posts.data.length);
  } catch (err) {
    console.error("[APP] doFetchPosts error:", err);
    showToast(`Lỗi: ${err.message}`, "error");
  }

  STATE.posts.loading = false;
  refreshPostsTable();
}

async function doLoadMorePosts() {
  await doFetchPosts(true);
}

// ── Single Actions ───────────────────────────────────────────────
async function doSingleDeletePost(postId) {
  showConfirm(
    "Xóa bài viết",
    "Bạn có chắc muốn xóa bài viết này? Hành động này không thể hoàn tác.",
    async () => {
      try {
        await API.deletePost(postId);
        STATE.posts.data     = STATE.posts.data.filter(p => p.id !== postId);
        STATE.posts.filtered = STATE.posts.filtered.filter(p => p.id !== postId);
        STATE.posts.selected.delete(postId);
        refreshPostsTable();
        showToast("✓ Đã xóa bài viết.", "success");
        updateNavBadge("posts", STATE.posts.data.length);
      } catch (err) {
        showToast(`Lỗi: ${err.message}`, "error");
      }
    }
  );
}

async function doSingleSetPrivate(postId) {
  try {
    await API.setPrivacy(postId, "SELF");
    const post = STATE.posts.data.find(p => p.id === postId);
    if (post) post.privacy = "ONLY_ME";
    const fpost = STATE.posts.filtered.find(p => p.id === postId);
    if (fpost) fpost.privacy = "ONLY_ME";
    refreshPostsTable();
    showToast("🔒 Đã đặt bài viết thành Chỉ mình tôi.", "success");
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, "error");
  }
}

// ── Bulk Delete ──────────────────────────────────────────────────
function doBulkDeletePosts() {
  const sel = [...STATE.posts.selected];
  if (sel.length === 0) return;

  showConfirm(
    `Xóa ${sel.length} bài viết`,
    `Bạn có chắc muốn xóa ${sel.length} bài viết? Hành động này không thể hoàn tác.`,
    async () => {
      const items = sel.map(id => STATE.posts.data.find(p => p.id === id)).filter(Boolean);

      const result = await runBulkAction(
        items,
        async (post) => {
          await API.deletePost(post.id);
          STATE.posts.data     = STATE.posts.data.filter(p => p.id !== post.id);
          STATE.posts.filtered = STATE.posts.filtered.filter(p => p.id !== post.id);
          STATE.posts.selected.delete(post.id);
        },
        (progress) => {
          renderProgressCard("posts-progress-area");
          refreshPostsTable();
        }
      );

      removeProgressCard("posts-progress-area");
      refreshPostsTable();
      updateNavBadge("posts", STATE.posts.data.length);

      const msg = result.cancelled
        ? `Đã dừng. ${result.success}/${items.length} bài đã xóa.`
        : `✓ Đã xóa ${result.success}/${items.length} bài. ${result.failed > 0 ? `${result.failed} lỗi.` : ""}`;
      showToast(msg, result.failed > 0 ? "warning" : "success");
    }
  );
}

// ── Bulk Set Private ─────────────────────────────────────────────
async function doBulkSetPrivate() {
  const sel = [...STATE.posts.selected];
  if (sel.length === 0) return;

  const items = sel.map(id => STATE.posts.data.find(p => p.id === id)).filter(Boolean);

  const result = await runBulkAction(
    items,
    async (post) => {
      await API.setPrivacy(post.id, "SELF");
      post.privacy = "ONLY_ME";
      const fpost = STATE.posts.filtered.find(p => p.id === post.id);
      if (fpost) fpost.privacy = "ONLY_ME";
    },
    () => {
      renderProgressCard("posts-progress-area");
      refreshPostsTable();
    }
  );

  removeProgressCard("posts-progress-area");
  STATE.posts.selected = new Set();
  refreshPostsTable();

  const msg = result.cancelled
    ? `Đã dừng. ${result.success}/${items.length} bài đã đặt private.`
    : `🔒 Đã đặt ${result.success}/${items.length} bài thành Chỉ mình tôi.`;
  showToast(msg, result.failed > 0 ? "warning" : "success");
}

/* ================================================================
   GROUPS SECTION
   ================================================================ */
function renderGroups(root) {
  const { data, filtered, selected, loading, fetchedAt } = STATE.groups;
  const { search, inactiveSince } = STATE.filters.groups;
  const selCount = selected.size;
  const stale = isStale(fetchedAt) && fetchedAt;

  const inactiveOpts = [
    { val: "ALL",     label: "Tất cả" },
    { val: "6m",      label: "6 tháng qua" },
    { val: "1y",      label: "1 năm qua" },
    { val: "2y",      label: "2 năm qua" },
    { val: "3y",      label: "3 năm qua" },
  ].map(o => `<option value="${o.val}" ${o.val === inactiveSince ? "selected" : ""}>${o.label}</option>`).join("");

  root.innerHTML = `
    <div class="section" id="groups-section">
      <div class="breadcrumb">
        <span>FB Manager</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">Joined Groups</span>
      </div>

      <div class="section-header">
        <div class="section-title-block">
          <h1 class="section-title">Joined Groups</h1>
          <p class="section-desc">Danh sách các nhóm bạn đang tham gia.</p>
        </div>
        <div class="section-actions" id="groups-header-actions">
          ${selCount > 0 ? `<button class="btn btn-danger btn-sm" id="btn-bulk-leave">→ Rời nhóm (${selCount})</button>` : ""}
          <button class="btn btn-ghost btn-sm" id="btn-groups-export">⬇ Export CSV</button>
          <button class="btn btn-ghost btn-sm" id="btn-groups-refresh">↻ Refresh Data</button>
          <button class="btn btn-primary btn-sm" id="btn-groups-fetch">⬇ Fetch Groups</button>
        </div>
      </div>

      ${stale ? `<div class="cache-banner"><span class="cache-banner-icon">⏱</span><span class="cache-banner-msg">Dữ liệu cũ — Refresh để cập nhật</span><button class="cache-banner-btn" id="btn-cache-refresh-groups">↻ Refresh</button></div>` : ""}

      <div id="groups-progress-area"></div>

      <div class="filter-bar">
        <input type="text" id="filter-group-search" placeholder="🔍 Tìm tên nhóm..." value="${escapeHtml(search)}" style="flex:1">
        <span class="filter-label">Chưa truy cập từ</span>
        <select id="filter-group-inactive">${inactiveOpts}</select>
      </div>

      <div class="table-wrap" id="groups-table-wrap">
        ${loading
          ? `<div class="loading-state"><div class="spinner"></div>Đang tải nhóm...</div>`
          : renderGroupsTable(filtered, selected)
        }
      </div>
    </div>
  `;

  bindGroupsEvents();
}

function renderGroupsTable(groups, selected) {
  if (groups.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <div class="empty-title">Chưa có nhóm</div>
        <div class="empty-desc">Nhấn "Fetch Groups" để tải danh sách nhóm từ Facebook.</div>
      </div>
    `;
  }

  const allSelected = groups.length > 0 && groups.every(g => selected.has(g.id));

  const rows = groups.map((group, i) => `
    <tr class="${selected.has(group.id) ? "selected" : ""}" data-id="${escapeHtml(group.id)}">
      <td><input type="checkbox" class="group-cb" data-id="${escapeHtml(group.id)}" ${selected.has(group.id) ? "checked" : ""}></td>
      <td>
        <div class="group-name-cell">
          <span class="group-icon">👥</span>
          <span class="group-name-text" title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</span>
        </div>
      </td>
      <td class="cell-mono">${escapeHtml(group.id)}</td>
      <td class="cell-date">${formatDatetime(group.lastVisited)}</td>
      <td class="cell-actions">
        <button class="btn-action btn-action-leave" data-action="leave" data-id="${escapeHtml(group.id)}">→ Rời nhóm</button>
      </td>
    </tr>
  `).join("");

  const hasMore = STATE.groups.cursor !== null;

  return `
    <div class="table-top-bar">
      <div class="table-count">
        Hiển thị <strong>${groups.length}</strong> nhóm
        ${selected.size > 0 ? ` · <strong>${selected.size}</strong> đã chọn` : ""}
        ${STATE.groups.data.length > 0 && STATE.groups.data[0]?.simulated ? '<span class="stale-badge" style="margin-left:6px">Demo</span>' : ""}
      </div>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:40px"><input type="checkbox" id="cb-select-all-groups" ${allSelected ? "checked" : ""}></th>
          <th>Tên nhóm</th>
          <th style="width:160px">ID</th>
          <th style="width:160px">Lần truy cập cuối</th>
          <th style="width:120px">Thao tác</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${hasMore ? `
      <div class="load-more-row">
        <button class="btn btn-ghost" id="btn-load-more-groups">⬇ Tải thêm</button>
      </div>
    ` : ""}
  `;
}

function refreshGroupsTable() {
  const wrap = document.getElementById("groups-table-wrap");
  if (wrap) wrap.innerHTML = renderGroupsTable(STATE.groups.filtered, STATE.groups.selected);
  bindGroupsTableEvents();
  updateGroupsHeaderActions();
}

function updateGroupsHeaderActions() {
  const area = document.getElementById("groups-header-actions");
  if (!area) return;
  const selCount = STATE.groups.selected.size;
  area.innerHTML = `
    ${selCount > 0 ? `<button class="btn btn-danger btn-sm" id="btn-bulk-leave">→ Rời nhóm (${selCount})</button>` : ""}
    <button class="btn btn-ghost btn-sm" id="btn-groups-export">⬇ Export CSV</button>
    <button class="btn btn-ghost btn-sm" id="btn-groups-refresh">↻ Refresh Data</button>
    <button class="btn btn-primary btn-sm" id="btn-groups-fetch">⬇ Fetch Groups</button>
  `;
  bindGroupsHeaderEvents();
}

function bindGroupsEvents() {
  bindGroupsHeaderEvents();
  bindGroupsTableEvents();
  // Live search
  document.getElementById("filter-group-search")?.addEventListener("input", filterGroupsClient);
  document.getElementById("filter-group-inactive")?.addEventListener("change", filterGroupsClient);
}

function bindGroupsHeaderEvents() {
  document.getElementById("btn-groups-fetch")?.addEventListener("click", () => doFetchGroups(false));
  document.getElementById("btn-groups-refresh")?.addEventListener("click", () => doFetchGroups(false));
  document.getElementById("btn-cache-refresh-groups")?.addEventListener("click", () => doFetchGroups(false));
  document.getElementById("btn-bulk-leave")?.addEventListener("click", doBulkLeaveGroups);
  document.getElementById("btn-groups-export")?.addEventListener("click", exportGroupsCSV);
}

function bindGroupsTableEvents() {
  const cbAll = document.getElementById("cb-select-all-groups");
  if (cbAll) {
    cbAll.addEventListener("change", () => {
      STATE.groups.filtered.forEach(g => {
        if (cbAll.checked) STATE.groups.selected.add(g.id);
        else               STATE.groups.selected.delete(g.id);
      });
      refreshGroupsTable();
    });
  }

  document.querySelectorAll(".group-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) STATE.groups.selected.add(cb.dataset.id);
      else            STATE.groups.selected.delete(cb.dataset.id);
      const row = cb.closest("tr");
      if (row) row.classList.toggle("selected", cb.checked);
      updateGroupsHeaderActions();
    });
  });

  document.querySelectorAll(".btn-action[data-action='leave']").forEach(btn => {
    btn.addEventListener("click", () => doSingleLeaveGroup(btn.dataset.id));
  });

  document.getElementById("btn-load-more-groups")?.addEventListener("click", () => doFetchGroups(true));
}

function filterGroupsClient() {
  const search       = document.getElementById("filter-group-search")?.value.toLowerCase().trim() || "";
  const inactiveSince = document.getElementById("filter-group-inactive")?.value || "ALL";

  STATE.filters.groups.search       = search;
  STATE.filters.groups.inactiveSince = inactiveSince;

  const now = Date.now();
  const thresholds = { "6m": 180, "1y": 365, "2y": 730, "3y": 1095 };
  const days = thresholds[inactiveSince];

  STATE.groups.filtered = STATE.groups.data.filter(g => {
    const nameMatch = !search || g.name.toLowerCase().includes(search);
    let dateMatch = true;
    if (days && g.lastVisited) {
      const lastVisited = new Date(g.lastVisited).getTime();
      dateMatch = (now - lastVisited) >= days * 86400000;
    }
    return nameMatch && dateMatch;
  });

  refreshGroupsTable();
}

async function doFetchGroups(loadMore = false) {
  if (STATE.groups.loading) return;

  STATE.groups.loading = true;
  if (!loadMore) {
    STATE.groups.data     = [];
    STATE.groups.filtered = [];
    STATE.groups.selected = new Set();
    STATE.groups.cursor   = null;
  }

  const wrap = document.getElementById("groups-table-wrap");
  if (wrap) wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div>Đang tải nhóm...</div>`;

  try {
    const resp = await API.fetchGroups(loadMore ? STATE.groups.cursor : null);
    const newGroups = resp.groups || [];
    if (loadMore) {
      STATE.groups.data = [...STATE.groups.data, ...newGroups];
    } else {
      STATE.groups.data = newGroups;
    }
    STATE.groups.cursor    = resp.nextCursor || null;
    STATE.groups.filtered  = [...STATE.groups.data];
    STATE.groups.fetchedAt = Date.now();

    chrome.storage.local.set({
      groups_cache: { data: STATE.groups.data, fetchedAt: STATE.groups.fetchedAt, cursor: STATE.groups.cursor }
    });

    updateNavBadge("groups", STATE.groups.data.length);
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, "error");
  }

  STATE.groups.loading = false;
  refreshGroupsTable();
}

async function doSingleLeaveGroup(groupId) {
  showConfirm(
    "Rời nhóm",
    "Bạn có chắc muốn rời khỏi nhóm này?",
    async () => {
      try {
        await API.leaveGroup(groupId);
        STATE.groups.data     = STATE.groups.data.filter(g => g.id !== groupId);
        STATE.groups.filtered = STATE.groups.filtered.filter(g => g.id !== groupId);
        STATE.groups.selected.delete(groupId);
        refreshGroupsTable();
        showToast("✓ Đã rời nhóm.", "success");
        updateNavBadge("groups", STATE.groups.data.length);
      } catch (err) {
        showToast(`Lỗi: ${err.message}`, "error");
      }
    }
  );
}

async function doBulkLeaveGroups() {
  const sel = [...STATE.groups.selected];
  if (sel.length === 0) return;

  showConfirm(
    `Rời ${sel.length} nhóm`,
    `Bạn có chắc muốn rời khỏi ${sel.length} nhóm đã chọn?`,
    async () => {
      const items = sel.map(id => STATE.groups.data.find(g => g.id === id)).filter(Boolean);

      const result = await runBulkAction(
        items,
        async (group) => {
          await API.leaveGroup(group.id);
          STATE.groups.data     = STATE.groups.data.filter(g => g.id !== group.id);
          STATE.groups.filtered = STATE.groups.filtered.filter(g => g.id !== group.id);
          STATE.groups.selected.delete(group.id);
        },
        () => {
          renderProgressCard("groups-progress-area");
          refreshGroupsTable();
        }
      );

      removeProgressCard("groups-progress-area");
      refreshGroupsTable();
      updateNavBadge("groups", STATE.groups.data.length);

      const msg = result.cancelled
        ? `Đã dừng. ${result.success}/${items.length} nhóm đã rời.`
        : `✓ Đã rời ${result.success}/${items.length} nhóm.`;
      showToast(msg, result.failed > 0 ? "warning" : "success");
    }
  );
}

function exportGroupsCSV() {
  if (STATE.groups.data.length === 0) {
    showToast("Không có dữ liệu để xuất.", "warning");
    return;
  }
  const headers = ["Tên nhóm", "ID", "Ngày truy cập cuối"];
  const rows = STATE.groups.filtered.map(g => [
    `"${g.name.replace(/"/g, '""')}"`,
    g.id,
    formatDatetime(g.lastVisited),
  ]);

  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `fb-groups-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✓ Đã xuất ${STATE.groups.filtered.length} nhóm ra CSV.`, "success");
}

/* ================================================================
   FRIENDS SECTION
   ================================================================ */
function renderFriends(root) {
  const { data, filtered, selected, loading, fetchedAt } = STATE.friends;
  const { search, mutualLessThan, addedFrom } = STATE.filters.friends;
  const selCount = selected.size;
  const stale = isStale(fetchedAt) && fetchedAt;

  const mutualOpts = [
    { val: "ALL", label: "Tất cả" },
    { val: "5",   label: "< 5 bạn chung" },
    { val: "10",  label: "< 10 bạn chung" },
    { val: "20",  label: "< 20 bạn chung" },
  ].map(o => `<option value="${o.val}" ${o.val === mutualLessThan ? "selected" : ""}>${o.label}</option>`).join("");

  const addedOpts = [
    { val: "ALL",    label: "Tất cả" },
    { val: "2024",   label: "Từ 2024" },
    { val: "2022",   label: "Từ 2022" },
    { val: "2020",   label: "Từ 2020" },
    { val: "before2020", label: "Trước 2020" },
  ].map(o => `<option value="${o.val}" ${o.val === addedFrom ? "selected" : ""}>${o.label}</option>`).join("");

  root.innerHTML = `
    <div class="section" id="friends-section">
      <div class="breadcrumb">
        <span>FB Manager</span>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">Friends</span>
      </div>

      <div class="section-header">
        <div class="section-title-block">
          <h1 class="section-title">Friends</h1>
          <p class="section-desc">Danh sách bạn bè của bạn trên Facebook.</p>
        </div>
        <div class="section-actions" id="friends-header-actions">
          ${selCount > 0 ? `<button class="btn btn-danger btn-sm" id="btn-bulk-unfriend">✕ Hủy kết bạn (${selCount})</button>` : ""}
          <button class="btn btn-ghost btn-sm" id="btn-friends-refresh">↻ Refresh Data</button>
          <button class="btn btn-primary btn-sm" id="btn-friends-fetch">⬇ Fetch Friends</button>
        </div>
      </div>

      ${stale ? `<div class="cache-banner"><span class="cache-banner-icon">⏱</span><span class="cache-banner-msg">Dữ liệu cũ — Refresh để cập nhật</span><button class="cache-banner-btn" id="btn-cache-refresh-friends">↻ Refresh</button></div>` : ""}

      <div id="friends-progress-area"></div>

      <div class="filter-bar">
        <input type="text" id="filter-friend-search" placeholder="🔍 Tìm tên..." value="${escapeHtml(search)}" style="flex:1">
        <span class="filter-label">Bạn chung ít hơn</span>
        <select id="filter-mutual">${mutualOpts}</select>
        <span class="filter-label">Kết bạn từ</span>
        <select id="filter-added-from">${addedOpts}</select>
      </div>

      <div class="table-wrap" id="friends-table-wrap">
        ${loading
          ? `<div class="loading-state"><div class="spinner"></div>Đang tải bạn bè...</div>`
          : renderFriendsTable(filtered, selected)
        }
      </div>
    </div>
  `;

  bindFriendsEvents();
}

function renderFriendsTable(friends, selected) {
  if (friends.length === 0) {
    return `
      <div class="empty-state">
        <div class="empty-icon">❤️</div>
        <div class="empty-title">Chưa có bạn bè</div>
        <div class="empty-desc">Nhấn "Fetch Friends" để tải danh sách bạn bè từ Facebook.</div>
      </div>
    `;
  }

  const allSelected = friends.length > 0 && friends.every(f => selected.has(f.id));

  const rows = friends.map((friend, i) => {
    const initials = getInitials(friend.name);
    return `
      <tr class="${selected.has(friend.id) ? "selected" : ""}" data-id="${escapeHtml(friend.id)}">
        <td><input type="checkbox" class="friend-cb" data-id="${escapeHtml(friend.id)}" ${selected.has(friend.id) ? "checked" : ""}></td>
        <td>
          <div class="friend-cell">
            <div class="friend-avatar">${escapeHtml(initials)}</div>
            <span class="friend-name">${escapeHtml(friend.name)}</span>
          </div>
        </td>
        <td class="cell-muted">${friend.mutualCount || 0} người</td>
        <td class="cell-date">${formatDate(friend.friendedAt)}</td>
        <td class="cell-actions">
          <button class="btn-action btn-action-danger" data-action="unfriend" data-id="${escapeHtml(friend.id)}">✕ Hủy kết bạn</button>
        </td>
      </tr>
    `;
  }).join("");

  const hasMore = STATE.friends.cursor !== null;

  return `
    <div class="table-top-bar">
      <div class="table-count">
        Hiển thị <strong>${friends.length}</strong> bạn bè
        ${selected.size > 0 ? ` · <strong>${selected.size}</strong> đã chọn` : ""}
        ${STATE.friends.data.length > 0 && STATE.friends.data[0]?.simulated ? '<span class="stale-badge" style="margin-left:6px">Demo</span>' : ""}
      </div>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th style="width:40px"><input type="checkbox" id="cb-select-all-friends" ${allSelected ? "checked" : ""}></th>
          <th>Tên</th>
          <th style="width:120px">Bạn chung</th>
          <th style="width:130px">Ngày kết bạn</th>
          <th style="width:140px">Thao tác</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${hasMore ? `
      <div class="load-more-row">
        <button class="btn btn-ghost" id="btn-load-more-friends">⬇ Tải thêm</button>
      </div>
    ` : ""}
  `;
}

function refreshFriendsTable() {
  const wrap = document.getElementById("friends-table-wrap");
  if (wrap) wrap.innerHTML = renderFriendsTable(STATE.friends.filtered, STATE.friends.selected);
  bindFriendsTableEvents();
  updateFriendsHeaderActions();
}

function updateFriendsHeaderActions() {
  const area = document.getElementById("friends-header-actions");
  if (!area) return;
  const selCount = STATE.friends.selected.size;
  area.innerHTML = `
    ${selCount > 0 ? `<button class="btn btn-danger btn-sm" id="btn-bulk-unfriend">✕ Hủy kết bạn (${selCount})</button>` : ""}
    <button class="btn btn-ghost btn-sm" id="btn-friends-refresh">↻ Refresh Data</button>
    <button class="btn btn-primary btn-sm" id="btn-friends-fetch">⬇ Fetch Friends</button>
  `;
  bindFriendsHeaderEvents();
}

function bindFriendsEvents() {
  bindFriendsHeaderEvents();
  bindFriendsTableEvents();
  document.getElementById("filter-friend-search")?.addEventListener("input", filterFriendsClient);
  document.getElementById("filter-mutual")?.addEventListener("change", filterFriendsClient);
  document.getElementById("filter-added-from")?.addEventListener("change", filterFriendsClient);
}

function bindFriendsHeaderEvents() {
  document.getElementById("btn-friends-fetch")?.addEventListener("click", () => doFetchFriends(false));
  document.getElementById("btn-friends-refresh")?.addEventListener("click", () => doFetchFriends(false));
  document.getElementById("btn-cache-refresh-friends")?.addEventListener("click", () => doFetchFriends(false));
  document.getElementById("btn-bulk-unfriend")?.addEventListener("click", doBulkUnfriend);
}

function bindFriendsTableEvents() {
  const cbAll = document.getElementById("cb-select-all-friends");
  if (cbAll) {
    cbAll.addEventListener("change", () => {
      STATE.friends.filtered.forEach(f => {
        if (cbAll.checked) STATE.friends.selected.add(f.id);
        else               STATE.friends.selected.delete(f.id);
      });
      refreshFriendsTable();
    });
  }

  document.querySelectorAll(".friend-cb").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) STATE.friends.selected.add(cb.dataset.id);
      else            STATE.friends.selected.delete(cb.dataset.id);
      const row = cb.closest("tr");
      if (row) row.classList.toggle("selected", cb.checked);
      updateFriendsHeaderActions();
    });
  });

  document.querySelectorAll(".btn-action[data-action='unfriend']").forEach(btn => {
    btn.addEventListener("click", () => doSingleUnfriend(btn.dataset.id));
  });

  document.getElementById("btn-load-more-friends")?.addEventListener("click", () => doFetchFriends(true));
}

function filterFriendsClient() {
  const search         = document.getElementById("filter-friend-search")?.value.toLowerCase().trim() || "";
  const mutualLessThan = document.getElementById("filter-mutual")?.value || "ALL";
  const addedFrom      = document.getElementById("filter-added-from")?.value || "ALL";

  STATE.filters.friends.search         = search;
  STATE.filters.friends.mutualLessThan = mutualLessThan;
  STATE.filters.friends.addedFrom      = addedFrom;

  STATE.friends.filtered = STATE.friends.data.filter(f => {
    const nameMatch = !search || f.name.toLowerCase().includes(search);

    let mutualMatch = true;
    if (mutualLessThan !== "ALL") {
      mutualMatch = (f.mutualCount || 0) < parseInt(mutualLessThan);
    }

    let dateMatch = true;
    if (addedFrom !== "ALL" && f.friendedAt) {
      const year = new Date(f.friendedAt).getFullYear();
      if (addedFrom === "before2020") dateMatch = year < 2020;
      else dateMatch = year >= parseInt(addedFrom);
    }

    return nameMatch && mutualMatch && dateMatch;
  });

  refreshFriendsTable();
}

async function doFetchFriends(loadMore = false) {
  if (STATE.friends.loading) return;

  STATE.friends.loading = true;
  if (!loadMore) {
    STATE.friends.data     = [];
    STATE.friends.filtered = [];
    STATE.friends.selected = new Set();
    STATE.friends.cursor   = null;
  }

  const wrap = document.getElementById("friends-table-wrap");
  if (wrap) wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div>Đang tải bạn bè...</div>`;

  try {
    const resp = await API.fetchFriends(loadMore ? STATE.friends.cursor : null);
    const newFriends = resp.friends || [];
    if (loadMore) {
      STATE.friends.data = [...STATE.friends.data, ...newFriends];
    } else {
      STATE.friends.data = newFriends;
    }
    STATE.friends.cursor    = resp.nextCursor || null;
    STATE.friends.filtered  = [...STATE.friends.data];
    STATE.friends.fetchedAt = Date.now();

    chrome.storage.local.set({
      friends_cache: { data: STATE.friends.data, fetchedAt: STATE.friends.fetchedAt, cursor: STATE.friends.cursor }
    });

    updateNavBadge("friends", STATE.friends.data.length);
  } catch (err) {
    showToast(`Lỗi: ${err.message}`, "error");
  }

  STATE.friends.loading = false;
  refreshFriendsTable();
}

async function doSingleUnfriend(friendId) {
  const friend = STATE.friends.data.find(f => f.id === friendId);
  showConfirm(
    "Hủy kết bạn",
    `Bạn có chắc muốn hủy kết bạn với ${friend?.name || "người này"}?`,
    async () => {
      try {
        await API.unfriend(friendId);
        STATE.friends.data     = STATE.friends.data.filter(f => f.id !== friendId);
        STATE.friends.filtered = STATE.friends.filtered.filter(f => f.id !== friendId);
        STATE.friends.selected.delete(friendId);
        refreshFriendsTable();
        showToast("✓ Đã hủy kết bạn.", "success");
        updateNavBadge("friends", STATE.friends.data.length);
      } catch (err) {
        showToast(`Lỗi: ${err.message}`, "error");
      }
    }
  );
}

async function doBulkUnfriend() {
  const sel = [...STATE.friends.selected];
  if (sel.length === 0) return;

  showConfirm(
    `Hủy kết bạn với ${sel.length} người`,
    `Bạn có chắc muốn hủy kết bạn với ${sel.length} người đã chọn? Hành động này không thể hoàn tác.`,
    async () => {
      const items = sel.map(id => STATE.friends.data.find(f => f.id === id)).filter(Boolean);

      const result = await runBulkAction(
        items,
        async (friend) => {
          await API.unfriend(friend.id);
          STATE.friends.data     = STATE.friends.data.filter(f => f.id !== friend.id);
          STATE.friends.filtered = STATE.friends.filtered.filter(f => f.id !== friend.id);
          STATE.friends.selected.delete(friend.id);
        },
        () => {
          renderProgressCard("friends-progress-area");
          refreshFriendsTable();
        }
      );

      removeProgressCard("friends-progress-area");
      refreshFriendsTable();
      updateNavBadge("friends", STATE.friends.data.length);

      const msg = result.cancelled
        ? `Đã dừng. ${result.success}/${items.length} người đã hủy kết bạn.`
        : `✕ Đã hủy kết bạn với ${result.success}/${items.length} người.`;
      showToast(msg, result.failed > 0 ? "warning" : "success");
    }
  );
}

/* ================================================================
   NAV BADGES
   ================================================================ */
function updateNavBadge(section, count) {
  const badge = document.getElementById(`nav-${section}-badge`);
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 999 ? "999+" : String(count);
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

/* ================================================================
   STORAGE LOADER
   ================================================================ */
async function loadFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(
      ["posts_cache", "groups_cache", "friends_cache", "settings"],
      (result) => {
        if (result.posts_cache) {
          STATE.posts.data      = result.posts_cache.data || [];
          STATE.posts.filtered  = [...STATE.posts.data];
          STATE.posts.fetchedAt = result.posts_cache.fetchedAt;
          STATE.posts.cursor    = result.posts_cache.cursor;
          updateNavBadge("posts", STATE.posts.data.length);
        }
        if (result.groups_cache) {
          STATE.groups.data      = result.groups_cache.data || [];
          STATE.groups.filtered  = [...STATE.groups.data];
          STATE.groups.fetchedAt = result.groups_cache.fetchedAt;
          STATE.groups.cursor    = result.groups_cache.cursor;
          updateNavBadge("groups", STATE.groups.data.length);
        }
        if (result.friends_cache) {
          STATE.friends.data      = result.friends_cache.data || [];
          STATE.friends.filtered  = [...STATE.friends.data];
          STATE.friends.fetchedAt = result.friends_cache.fetchedAt;
          STATE.friends.cursor    = result.friends_cache.cursor;
          updateNavBadge("friends", STATE.friends.data.length);
        }
        if (result.settings) {
          Object.assign(STATE.settings, result.settings);
        }
        resolve();
      }
    );
  });
}

/* ================================================================
   FB CONNECTION CHECK
   ================================================================ */
async function checkFbConnection() {
  const { found } = await API.checkFbTab();
  STATE.fbConnected = found;

  const userStatus = document.getElementById("user-status");
  const userAvatar = document.getElementById("user-avatar");
  const userName   = document.getElementById("user-name");

  if (found) {
    if (userStatus) userStatus.textContent = "Facebook đang mở ✓";
    if (userStatus) userStatus.style.color = "var(--accent)";
    
    try {
      const resp = await API.send("GET_TOKENS");
      if (resp && resp.uid) {
        STATE.fbUserId = resp.uid;
        if (userName) userName.textContent = `UID: ${resp.uid}`;
        if (userAvatar) {
          userAvatar.style.backgroundImage = `url('https://graph.facebook.com/${resp.uid}/picture?type=small')`;
          userAvatar.style.backgroundSize = "cover";
          userAvatar.style.backgroundPosition = "center";
          userAvatar.textContent = "";
        }
      }
    } catch (e) {
      console.log("Could not get FB UID:", e);
    }
  } else {
    if (userStatus) userStatus.textContent = "Chưa mở Facebook";
    if (userStatus) userStatus.style.color = "var(--warning)";
    if (userAvatar) {
      userAvatar.style.backgroundImage = "";
      userAvatar.textContent = "?";
    }
    if (userName)   userName.textContent   = "Khách";
  }
}

/* ================================================================
   INIT
   ================================================================ */
async function init() {
  // Listen for navigation messages from popup
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "NAVIGATE" && msg.section) {
      navigate(msg.section);
    }
  });

  // Load cached data
  await loadFromStorage();

  // Check FB connection
  await checkFbConnection();

  // Bind sidebar nav
  document.querySelectorAll(".nav-item[data-section]").forEach(btn => {
    btn.addEventListener("click", () => navigate(btn.dataset.section));
  });

  // Handle URL hash
  const hash = location.hash.replace("#", "");
  const validSections = ["home", "posts", "groups", "friends"];
  const section = validSections.includes(hash) ? hash : "home";

  navigate(section);
}

// Boot
init().catch(console.error);
