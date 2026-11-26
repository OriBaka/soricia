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
  votesPath: "votes",
  collectionPath: "collection",
  // Web API key (public) from Firebase Console → Project settings → Your apps.
  // Leave empty to keep the old local-only editing mode.
  authApiKey: "AIzaSyDZWl63Bl1eQgQGolMR4_Y_gQNAY469TlM",
  // Owner email must also be written into firebase/rules.json (auth.token.email).
  ownerEmail: "fghrtyu1203@gmail.com",
  // Firebase Storage requires a paid Blaze project. Empty = keep uploaded images in
  // IndexedDB (no billing). Set the bucket name later only if Blaze is enabled.
  storageBucket: ""
};
