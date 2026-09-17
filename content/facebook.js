/**
 * FB Manager — content/facebook.js
 * Content script chạy trên facebook.com
 * Chịu trách nhiệm: extract tokens, gọi GraphQL API, trả kết quả về background
 */

/* ------------------------------------------------------------------ */
/*  Doc IDs (inline để tránh import trong content script)              */
/* ------------------------------------------------------------------ */
const FB_DOC_IDS = {
  SET_POST_PRIVACY: "28375855785348843",
  FETCH_FRIENDS: "26206414195674994",
};

const RELAY_PV = {
  __relay_internal__pv__GHLShouldChangeAdIdFieldNamerelayprovider: true,
  __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true,
  __relay_internal__pv__CometFeedStory_enable_reactor_facepilerelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_social_bubblesrelayprovider: false,
  __relay_internal__pv__CometFeedStory_enable_post_permalink_white_space_clickrelayprovider: false,
  __relay_internal__pv__CometUFICommentActionLinksRewriteEnabledrelayprovider: true,
  __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false,
  __relay_internal__pv__IsWorkUserrelayprovider: false,
  __relay_internal__pv__TestPilotShouldIncludeDemoAdUseCaserelayprovider: false,
  __relay_internal__pv__FBReels_deprecate_short_form_video_context_gkrelayprovider: true,
  __relay_internal__pv__FBReels_enable_view_dubbed_audio_type_gkrelayprovider: true,
  __relay_internal__pv__CometFeedShareMedia_shouldPrefetchShareImagerelayprovider: true,
  __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
  __relay_internal__pv__WorkCometIsEmployeeGKProviderrelayprovider: false,
  __relay_internal__pv__IsMergQAPollsrelayprovider: false,
  __relay_internal__pv__FBReelsMediaFooter_comet_enable_reels_ads_gkrelayprovider: true,
  __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false,
  __relay_internal__pv__CometUFICommentAutoTranslationTyperelayprovider:
    "AUTO_TRANSLATE",
  __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
  __relay_internal__pv__CometUFISingleLineUFIrelayprovider: false,
  __relay_internal__pv__relay_provider_comet_ufi_ssr_seo_deferrelayprovider: true,
  __relay_internal__pv__CometUFI_dedicated_comment_routable_dialog_gkrelayprovider: true,
  __relay_internal__pv__ReelsIFUCard_reelsIFULikeCountrelayprovider: false,
  __relay_internal__pv__FBReelsIFUTileContent_reelsIFUPlayOnHoverrelayprovider: true,
  __relay_internal__pv__GroupsCometGYSJFeedItemHeightrelayprovider: 206,
  __relay_internal__pv__ShouldEnableBakedInTextStoriesrelayprovider: false,
  __relay_internal__pv__StoriesShouldIncludeFbNotesrelayprovider: false,
};

function buildFetchPostsVariables({
  uid,
  cursor = null,
  afterTime = null,
  beforeTime = null,
}) {
  return {
    afterTime,
    beforeTime,
    count: 10,
    cursor,
    feedLocation: "TIMELINE",
    feedbackSource: 0,
    focusCommentID: null,
    memorializedSplitTimeFilter: null,
    omitPinnedPost: true,
    postedBy: null,
    privacy: null,
    privacySelectorRenderLocation: "COMET_STREAM",
    referringStoryRenderLocation: null,
    renderLocation: "timeline",
    scale: 1,
    stream_count: 1,
    taggedInOnly: null,
    trackingCode: null,
    useDefaultActor: false,
    id: uid,
    ...RELAY_PV,
  };
}

/* ------------------------------------------------------------------ */
/*  Token Extraction                                                    */
/* ------------------------------------------------------------------ */

function getFbDtsg() {
  // Ưu tiên lấy từ inline script (reliable nhất)
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    const m = text.match(/"DTSGInitialData"[^}]*?"token":"([^"]+)"/);
    if (m) return m[1];
  }
  // Fallback 1: meta tag
  const meta = document.querySelector('meta[name="fb:dtsg"]');
  if (meta) return meta.getAttribute("content");
  // Fallback 2: input hidden
  const el = document.querySelector('input[name="fb_dtsg"]');
  return el?.value ?? null;
}

function getMyUid() {
  // Từ cookie c_user
  const m = document.cookie.match(/c_user=(\d+)/);
  if (m) return m[1];
  // Fallback: từ script
  for (const script of document.querySelectorAll("script")) {
    const text = script.textContent;
    const uid = text.match(/"USER_ID":"(\d+)"/);
    if (uid) return uid[1];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  GraphQL Helper                                                      */
/* ------------------------------------------------------------------ */

async function fbGraphQL(docId, variables) {
  const dtsg = getFbDtsg();
  const uid = getMyUid();

  if (!dtsg)
    throw new Error("Không lấy được fb_dtsg token. Hãy thử reload Facebook.");
  if (!uid)
    throw new Error(
      "Không lấy được User ID. Hãy đảm bảo bạn đã đăng nhập Facebook.",
    );

  const params = new URLSearchParams();
  params.append("doc_id", docId);
  params.append("variables", JSON.stringify(variables));
  params.append("fb_dtsg", dtsg);
  params.append("fb_api_caller_class", "RelayModern");
  params.append("fb_api_req_friendly_name", "FBManagerRequest");
  params.append("server_timestamps", "true");

  const resp = await fetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-FB-Friendly-Name": "FBManagerRequest",
    },
    body: params.toString(),
  });

  if (resp.status === 429) {
    throw new Error(
      "RATE_LIMITED: Facebook đang giới hạn tốc độ. Hãy tăng delay và thử lại.",
    );
  }

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  const text = await resp.text();

  // Facebook đôi khi trả về multiple JSON objects (multipart)
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    // Thử parse dòng đầu tiên
    const firstLine = text.split("\n")[0].trim();
    data = JSON.parse(firstLine);
  }

  if (data.errors && data.errors.length > 0) {
    throw new Error(`GraphQL Error: ${data.errors[0].message}`);
  }

  return data;
}

/* ------------------------------------------------------------------ */
/*  Action Implementations                                              */
/* ------------------------------------------------------------------ */

async function deletePost(storyId) {
  if (FB_DOC_IDS.DELETE_POST === "PASTE_DOC_ID_HERE") {
    // Simulate cho testing UI
    return { success: true, simulated: true };
  }
  const data = await fbGraphQL(FB_DOC_IDS.DELETE_POST, {
    story_id: storyId,
    source: "TIMELINE",
  });
  const ok =
    data?.data?.story_delete?.story?.id === storyId ||
    data?.data?.story_delete?.success === true;
  return { success: ok };
}

async function setPostPrivacy(storyId, privacy) {
  // privacy: "SELF" | "FRIENDS" | "EVERYONE"
  if (FB_DOC_IDS.SET_POST_PRIVACY === "PASTE_DOC_ID_HERE") {
    return { success: true, simulated: true };
  }
  const data = await fbGraphQL(FB_DOC_IDS.SET_POST_PRIVACY, {
    story_id: storyId,
    audience: privacy,
  });
  return { success: true, data };
}

function buildFetchGroupsVariables({ cursor = null } = {}) {
  return {
    count: 20,
    cursor,
    ...RELAY_PV,
  };
}

function parseGroupsResponse(response) {
  const edges =
    response?.data?.viewer?.all_joined_groups?.tab_groups_list?.edges;

  if (!edges || !Array.isArray(edges)) {
    console.error(
      "[FB Manager] parseGroupsResponse: không tìm thấy edges",
      response,
    );
    return { groups: [], nextCursor: null, hasNextPage: false };
  }

  const groups = edges
    .map((edge) => {
      const node = edge.node;
      return {
        id: node.id,
        name: node.name,
        url: node.url,
        avatarUrl: node.profile_picture?.uri ?? null,
        lastVisitedTime: node.viewer_last_visited_time, // Unix timestamp giây
        lastVisitedDate: node.viewer_last_visited_time
          ? new Date(node.viewer_last_visited_time * 1000).toLocaleString(
              "vi-VN",
            )
          : "Chưa truy cập",
        lastVisited: node.viewer_last_visited_time
          ? new Date(node.viewer_last_visited_time * 1000).toISOString()
          : null,
        cursor: edge.cursor, // cursor của từng item nếu cần
      };
    })
    .filter((g) => g.id);

  // Pagination: lấy cursor của item cuối cùng
  const lastEdge = edges[edges.length - 1];

  return {
    groups,
    nextCursor: lastEdge?.cursor ?? null,
    hasNextPage: edges.length > 0,
  };
}

async function fetchGroups({ cursor = null } = {}) {
  if (
    FB_DOC_IDS.FETCH_GROUPS === "PASTE_DOC_ID_HERE" ||
    !FB_DOC_IDS.FETCH_GROUPS
  ) {
    return generateDemoGroups(cursor);
  }
  const variables = buildFetchGroupsVariables({ cursor });
  const raw = await fbGraphQL(FB_DOC_IDS.FETCH_GROUPS, variables);

  if (raw?.errors?.length) {
    throw new Error(raw.errors[0]?.message ?? "GraphQL error");
  }

  return parseGroupsResponse(raw);
}

function parsePostsResponse(response) {
  const edges = response?.data?.node?.timeline_list_feed_units?.edges;

  if (!edges || !Array.isArray(edges)) {
    console.error(
      "[DEBUG] parsePostsResponse: không tìm thấy edges",
      response?.data,
    );
    return { posts: [], nextCursor: null, hasNextPage: false };
  }

  const posts = edges
    .filter((edge) => edge?.node?.__typename === "Story")
    .map((edge) => {
      const node = edge.node;
      const cs = node.comet_sections; // shortcut

      // ── Nội dung bài viết ──────────────────────────────────────────
      // Thứ tự ưu tiên: bài text → comet content → reshare có caption →
      //                 reshare qua comet → share link → reshare không có → ảnh/video
      const preview =
        node.message?.text ??
        cs?.content?.story?.message?.text ??
        node.attached_story?.message?.text ??
        node.attached_story?.comet_sections?.content?.story?.message?.text ??
        node.attachments?.[0]?.title?.text ??
        (node.attached_story ? "[Bài chia sẻ]" : null) ??
        (node.attachments?.length > 0 ? "[Bài đăng ảnh/video]" : null) ??
        "(Không có nội dung)";

      // ── Ngày đăng ─────────────────────────────────────────────────
      const createdDate = node.creation_time
        ? new Date(node.creation_time * 1000).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : "Không rõ";

      // ── Privacy ───────────────────────────────────────────────────
      // Privacy nằm trong comet_sections.context_layout hoặc .header
      const privacyRaw =
        cs?.context_layout?.story?.privacy?.value ??
        cs?.header?.story?.privacy?.value ??
        cs?.context_layout?.story?.privacy?.allow?.base_state ??
        cs?.header?.story?.privacy?.allow?.base_state ??
        node.privacy?.value ??
        node.privacy?.allow?.base_state ??
        "UNKNOWN";

      // Log để debug nếu vẫn UNKNOWN
      if (privacyRaw === "UNKNOWN") {
        console.warn(
          "[DEBUG privacy] UNKNOWN — comet_sections keys:",
          cs ? Object.keys(cs) : null,
        );
        console.warn(
          "[DEBUG privacy] context_layout:",
          JSON.stringify(cs?.context_layout?.story?.privacy),
        );
        console.warn(
          "[DEBUG privacy] header:",
          JSON.stringify(cs?.header?.story?.privacy),
        );
      }

      const PRIVACY_MAP = {
        EVERYONE: "PUBLIC",
        FRIENDS: "FRIENDS",
        SELF: "ONLY_ME",
        EVERYONE_NO_TAGGED: "PUBLIC",
        CUSTOM: "CUSTOM",
      };
      const privacy = PRIVACY_MAP[privacyRaw] ?? privacyRaw;

      return {
        id: node.id, // base64 — dùng cho GraphQL mutation
        postId: node.post_id, // numeric
        preview,
        createdDate,
        createdTime: node.creation_time,
        privacy,
        likes: node.feedback?.reaction_count?.count ?? 0,
        isReshare: !!node.attached_story,
      };
    })
    .filter((p) => p.id);

  const pageInfo = response?.data?.node?.timeline_list_feed_units?.page_info;

  return {
    posts,
    nextCursor: pageInfo?.end_cursor ?? null,
    hasNextPage: pageInfo?.has_next_page ?? false,
  };
}

async function fetchPosts({
  cursor = null,
  yearFrom = null,
  yearTo = null,
  privacy = null,
} = {}) {
  console.log(
    "[DEBUG] fetchPosts called, FETCH_POSTS doc_id:",
    FB_DOC_IDS.FETCH_POSTS,
  ); // ← thêm dòng này
  if (
    FB_DOC_IDS.FETCH_POSTS === "PASTE_DOC_ID_HERE" ||
    !FB_DOC_IDS.FETCH_POSTS
  ) {
    // Trả về dữ liệu demo để test UI
    return generateDemoPosts(yearFrom, yearTo, privacy, cursor);
  }
  const uid = getMyUid();
  if (!uid) throw new Error("Không lấy được UID");

  const afterTime = yearFrom
    ? Math.floor(new Date(`${yearFrom}-01-01T00:00:00`).getTime() / 1000)
    : null;
  const beforeTime = yearTo
    ? Math.floor(new Date(`${yearTo}-12-31T23:59:59`).getTime() / 1000)
    : null;

  const variables = buildFetchPostsVariables({
    uid,
    cursor,
    afterTime,
    beforeTime,
  });
  if (privacy && privacy !== "ALL") {
    variables.privacy = privacy;
  }

  const raw = await fbGraphQL(FB_DOC_IDS.FETCH_POSTS, variables);

  if (raw?.errors?.length) {
    throw new Error(raw.errors[0]?.message ?? "GraphQL error");
  }

  console.log("[DEBUG] Posts raw:", JSON.stringify(raw?.data?.node, null, 2));

  return parsePostsResponse(raw);
}

async function leaveGroup(groupId) {
  if (
    FB_DOC_IDS.LEAVE_GROUP === "PASTE_DOC_ID_HERE" ||
    !FB_DOC_IDS.LEAVE_GROUP
  ) {
    return { success: true, simulated: true };
  }
  const data = await fbGraphQL(FB_DOC_IDS.LEAVE_GROUP, {
    groupID: groupId,
  });
  return { success: true, data };
}

async function unfriend(friendId) {
  if (FB_DOC_IDS.UNFRIEND === "PASTE_DOC_ID_HERE" || !FB_DOC_IDS.UNFRIEND) {
    return { success: true, simulated: true };
  }
  const data = await fbGraphQL(FB_DOC_IDS.UNFRIEND, {
    unfriend_user_id: friendId,
  });
  return { success: true, data };
}

function parseFriendsResponse(response) {
  // ⚠️ Path đúng: data.viewer.all_friends.edges
  const edges = response?.data?.viewer?.all_friends?.edges;

  if (!edges || !Array.isArray(edges)) {
    console.error(
      "[FB Manager] parseFriendsResponse: không tìm thấy edges",
      response,
    );
    return { friends: [], nextCursor: null, hasNextPage: false };
  }

  const friends = edges
    .map((edge) => {
      const node = edge.node;

      const mutualText = node?.social_context?.text ?? ""; // "4 bạn chung"
      const mutualCount = parseInt(mutualText.match(/\d+/)?.[0] ?? "0", 10);

      // Lấy initials từ tên (hiển thị avatar)
      const nameParts = (node?.name ?? "").split(" ");
      const initials =
        nameParts.length >= 2
          ? nameParts[0][0] + nameParts[nameParts.length - 1][0]
          : (nameParts[0]?.[0] ?? "?");

      return {
        id: node.id,
        name: node.name ?? "Unknown",
        mutualCount,
        mutualText,
        initials: initials.toUpperCase(),
        friendedAt: null,
      };
    })
    .filter((f) => f.id);

  // Pagination
  const pageInfo = response?.data?.viewer?.all_friends?.page_info;

  return {
    friends,
    nextCursor: pageInfo?.end_cursor ?? null,
    hasNextPage: pageInfo?.has_next_page ?? false,
  };
}

async function fetchFriends({ cursor = null } = {}) {
  if (
    FB_DOC_IDS.FETCH_FRIENDS === "PASTE_DOC_ID_HERE" ||
    !FB_DOC_IDS.FETCH_FRIENDS
  ) {
    return generateDemoFriends(cursor);
  }
  const uid = getMyUid();
  if (!uid) throw new Error("Không lấy được UID");

  const variables = {
    count: 30,
    cursor: cursor || null, // ← null lần đầu, end_cursor các lần sau
    name: null,
    scale: 1,
    ...RELAY_PV,
  };

  const raw = await fbGraphQL(FB_DOC_IDS.FETCH_FRIENDS, variables);

  // Kiểm tra lỗi GraphQL
  if (raw?.errors?.length) {
    throw new Error(raw.errors[0]?.message ?? "GraphQL error");
  }

  // Parse đúng path
  return parseFriendsResponse(raw);
}

/* ------------------------------------------------------------------ */
/*  Normalizers                                                         */
/* ------------------------------------------------------------------ */

function normalizePost(node) {
  return {
    id: node?.id || node?.story_id,
    content:
      node?.message?.text ||
      node?.comet_sections?.content?.story?.message?.text ||
      "[Không có nội dung]",
    date: node?.creation_time
      ? new Date(node.creation_time * 1000).toISOString()
      : null,
    privacy: node?.privacy?.value || "FRIENDS",
    likes: node?.feedback?.reaction_count?.count || 0,
    url: `https://www.facebook.com/${node?.id}`,
  };
}

function normalizeGroup(node) {
  return {
    id: node?.id,
    name: node?.name || "Nhóm không tên",
    lastVisited: node?.viewer_last_seen_time
      ? new Date(node.viewer_last_seen_time * 1000).toISOString()
      : null,
    memberCount: node?.member_count?.count || 0,
    url: `https://www.facebook.com/groups/${node?.id}`,
  };
}

function normalizeFriend(node) {
  return {
    id: node?.id,
    name: node?.name || "Không tên",
    mutualCount: node?.mutual_friends?.count || 0,
    friendedAt: node?.friendship_time
      ? new Date(node.friendship_time * 1000).toISOString()
      : null,
    profileUrl: `https://www.facebook.com/${node?.id}`,
  };
}

/* ------------------------------------------------------------------ */
/*  Demo Data Generators (dùng khi chưa có doc_id thật)               */
/* ------------------------------------------------------------------ */

// Hàm tạo số giả ngẫu nhiên có seed — đảm bảo mỗi lần fetch cùng page cho cùng kết quả
function seededRand(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateDemoPosts(yearFrom, yearTo, privacy, cursor) {
  const privacies = ["PUBLIC", "FRIENDS", "ONLY_ME"];
  const contents = [
    "Hôm nay trời đẹp quá, ra ngoài chạy bộ một vòng 🏃",
    "Vừa xem xong bộ phim hay, recommend mọi người xem thử!",
    "Check-in tại Đà Nẵng, biển xanh cát trắng 🌊",
    "Chia sẻ bài viết hay về lập trình...",
    "Sinh nhật mình năm nay thật vui! Cảm ơn mọi người ❤️",
    "Update: Vừa đổi công việc mới, excited lắm!",
    "Cùng bạn bè đi cà phê cuối tuần ☕",
    "Một ngày làm việc productive, hoàn thành target 🎯",
    "Thời tiết Hà Nội hôm nay se lạnh, thích quá",
    "Vừa đọc xong cuốn sách hay, highly recommend!",
    "Team building với đồng nghiệp, vui vẻ 🎉",
    "Mùa hè tới rồi, kế hoạch đi biển thôi!",
    "Hình ảnh từ chuyến du lịch Sapa gần đây 🏔️",
    "Review nhà hàng mới mở gần nhà, ngon lắm!",
    "Chiếc laptop mới về, setup workspace đẹp 💻",
    "Kết thúc một năm với nhiều kỷ niệm đáng nhớ",
    "Đang học thêm kỹ năng mới, growing mindset!",
    "Cuối tuần cùng gia đình, ấm áp quá 🏡",
    "Vừa hoàn thành project lớn sau 3 tháng 🚀",
    "Nhớ lại những ngày sinh viên, thật vui...",
  ];

  const page = cursor ? parseInt(cursor) : 0;
  if (page >= 3) return { posts: [], nextCursor: null };

  const posts = contents.map((content, i) => {
    const idx = page * 20 + i + 1;
    const rand = seededRand(idx * 31 + page * 7);
    const yearRange = Math.max(1, yearTo - yearFrom);
    const year = yearFrom + Math.floor(rand() * yearRange);
    const month = Math.floor(rand() * 12) + 1;
    const day = Math.floor(rand() * 28) + 1;
    const priv = privacies[Math.floor(rand() * privacies.length)];
    return {
      id: `post_demo_${idx}`,
      content,
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T10:00:00.000Z`,
      privacy: priv,
      likes: Math.floor(rand() * 200),
      url: `https://www.facebook.com/demo/${idx}`,
    };
  });

  const filtered =
    privacy === "ALL" ? posts : posts.filter((p) => p.privacy === privacy);

  return {
    posts: filtered,
    nextCursor: page < 2 ? String(page + 1) : null,
    simulated: true,
  };
}

function generateDemoGroups(cursor) {
  const names = [
    "Hội Lập Trình Viên Việt Nam",
    "Cộng đồng Marketing Online",
    "Nhóm Chia Sẻ Kinh Nghiệm Du Lịch",
    "Team Building Công Ty ABC",
    "Hội Yêu Mèo Hà Nội",
    "Cộng đồng Startup Việt",
    "Nhóm Học Tiếng Anh Online",
    "Hội Đồng Hương Nghệ An",
    "Cộng đồng Nhiếp Ảnh Gia",
    "Nhóm Review Phim Việt Nam",
    "Hội Nấu Ăn Tại Nhà",
    "Cộng Đồng Crypto Việt Nam",
    "Nhóm Thể Thao Cuối Tuần",
    "Hội Đọc Sách Mỗi Ngày",
    "Cộng đồng Freelancer VN",
    "Nhóm Chơi Game Online",
    "Hội Bảo Vệ Môi Trường",
    "Cộng đồng Thiết Kế Đồ Họa",
    "Nhóm Chia Sẻ Công Thức Nấu Ăn",
    "Hội Yêu Thể Thao Điện Tử",
  ];

  const page = cursor ? parseInt(cursor) : 0;
  if (page >= 2) return { groups: [], nextCursor: null };

  const groups = names.map((name, i) => {
    // ID cố định theo vị trí — không dùng random để tránh trùng lặp khi Refresh
    const idx = page * 20 + i + 1;
    const rand = seededRand(idx * 13 + 42);
    const yearsAgo = Math.floor(rand() * 4);
    const lastDate = new Date(2025, 0, 1); // base date cố định
    lastDate.setFullYear(lastDate.getFullYear() - yearsAgo);
    lastDate.setMonth(Math.floor(rand() * 12));
    lastDate.setDate(Math.floor(rand() * 28) + 1);
    return {
      id: `group_demo_${idx}`, // ID cố định
      name,
      lastVisited: lastDate.toISOString(),
      memberCount: Math.floor(rand() * 50000) + 100,
      url: `https://www.facebook.com/groups/demo`,
    };
  });

  return {
    groups,
    nextCursor: page < 1 ? String(page + 1) : null,
    simulated: true,
  };
}

function generateDemoFriends(cursor) {
  const firstNames = [
    "Nguyễn Văn",
    "Trần Thị",
    "Lê Minh",
    "Phạm Thị",
    "Hoàng Văn",
    "Vũ Thị",
    "Đặng Minh",
    "Bùi Văn",
    "Hồ Thị",
    "Ngô Văn",
  ];
  const lastNames = [
    "An",
    "Bình",
    "Cường",
    "Dung",
    "Em",
    "Phong",
    "Giang",
    "Hương",
    "Khoa",
    "Long",
    "Mai",
    "Nam",
    "Oanh",
    "Phúc",
    "Quân",
    "Sơn",
    "Thắng",
    "Uyên",
    "Vinh",
    "Xuân",
  ];

  const page = cursor ? parseInt(cursor) : 0;
  if (page >= 2) return { friends: [], nextCursor: null };

  const friends = Array.from({ length: 20 }, (_, i) => {
    const idx = page * 20 + i + 1;
    const rand = seededRand(idx * 17 + 99);
    const fn = firstNames[Math.floor(rand() * firstNames.length)];
    const ln = lastNames[Math.floor(rand() * lastNames.length)];
    const yearsAgo = Math.floor(rand() * 8);
    const friendedDate = new Date(2025, 0, 1);
    friendedDate.setFullYear(friendedDate.getFullYear() - yearsAgo);
    friendedDate.setMonth(Math.floor(rand() * 12));
    friendedDate.setDate(Math.floor(rand() * 28) + 1);
    return {
      id: `friend_demo_${idx}`, // ID cố định
      name: `${fn} ${ln}`,
      mutualCount: Math.floor(rand() * 50),
      friendedAt: friendedDate.toISOString(),
      profileUrl: `https://www.facebook.com/demo`,
    };
  });

  return {
    friends,
    nextCursor: page < 1 ? String(page + 1) : null,
    simulated: true,
  };
}

/* ------------------------------------------------------------------ */
/*  Message Listener                                                    */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "FB_ACTION") return;

  handleAction(msg)
    .then((result) => {
      sendResponse({ success: true, ...result });
    })
    .catch((err) => {
      const isRateLimited = err.message?.startsWith("RATE_LIMITED");
      sendResponse({
        success: false,
        error: err.message,
        rateLimited: isRateLimited,
      });
    });

  return true; // Async response
});

async function handleAction(msg) {
  const { action, payload = {} } = msg;

  switch (action) {
    case "FETCH_POSTS": {
      const { yearFrom, yearTo, privacy, cursor } = payload;
      return fetchPosts({ yearFrom, yearTo, privacy, cursor });
    }

    case "DELETE_POST":
      return deletePost(payload.storyId);

    case "SET_PRIVACY":
      return setPostPrivacy(payload.storyId, payload.privacy);

    case "FETCH_GROUPS": {
      const { cursor } = payload;
      return fetchGroups({ cursor });
    }

    case "LEAVE_GROUP":
      return leaveGroup(payload.groupId);

    case "FETCH_FRIENDS": {
      const { cursor } = payload;
      return fetchFriends({ cursor });
    }

    case "UNFRIEND":
      return unfriend(payload.friendId);

    case "GET_TOKENS":
      return {
        dtsg: getFbDtsg(),
        uid: getMyUid(),
        hasTokens: !!(getFbDtsg() && getMyUid()),
      };

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

console.log("[FB Manager] Content script loaded ✓");
