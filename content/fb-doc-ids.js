/**
 * FB Manager — content/fb-doc-ids.js
 *
 * HƯỚNG DẪN LẤY DOC_ID:
 * 1. Mở Facebook → F12 → tab Network
 * 2. Filter bằng "graphql" trong ô tìm kiếm
 * 3. Thực hiện action thủ công (xóa post, rời nhóm, v.v.)
 * 4. Xem request xuất hiện trong Network tab
 * 5. Click vào request → tab Payload → tìm "doc_id"
 * 6. Copy giá trị doc_id vào đây
 *
 * Lưu ý: doc_id có thể thay đổi khi Facebook cập nhật
 * Cần kiểm tra và cập nhật định kỳ nếu các feature không hoạt động
 */

const FB_DOC_IDS = {
  // Xóa bài viết khỏi timeline
  DELETE_POST: "26146132388368957",

  // Đổi quyền riêng tư bài viết
  SET_POST_PRIVACY: "28375855785348843",

  // Rời nhóm Facebook
  LEAVE_GROUP: "27963427739922069",

  // Hủy kết bạn
  UNFRIEND: "24028849793460009",

  // Lấy danh sách bài viết trên timeline
  FETCH_POSTS: "27465012859856795",

  // Lấy danh sách nhóm đã tham gia
  FETCH_GROUPS: "9974006939348139",

  // Lấy danh sách bạn bè
  FETCH_FRIENDS: "26206414195674994",
};
