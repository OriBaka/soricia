/**
 * Cấu hình bình chọn (Firebase Realtime Database).
 *
 * URL public của database, không phải secret. Để trong Firebase Console:
 * Build → Realtime Database → tab Data / Rules. Áp dụng firebase/rules.json
 * vào tab Rules để khách được gửi điểm nhưng không xoá/sửa dữ liệu.
 *
 * Để trống firebaseUrl nếu chưa muốn bật bình chọn.
 */
window.SITE_CONFIG = {
  firebaseUrl: "https://soricia-default-rtdb.firebaseio.com",
  votesPath: "votes"
};
