# Soricia — nhạc & anime của tôi

Trang web cá nhân để xếp hạng bài hát theo thể loại và ghi điểm những bộ anime đã xem.
Chạy hoàn toàn bằng HTML/CSS/JavaScript tĩnh, không cần cài đặt hay build.

**Website:** https://oribaka.github.io/soricia/

> Nếu website chưa tải được, cần bật GitHub Pages **một lần duy nhất**:
> vào `Settings → Pages → Build and deployment → Source → Deploy from a branch`,
> chọn `main` / `/(root)` rồi bấm `Save`.

## Thêm/sửa ngay trên web (chế độ chủ web)

Người xem bình thường **chỉ thấy nút chấm điểm**. Để hiện nút Quản lý / Thêm / Sửa / Xoá trên trình duyệt của bạn:

- Mở `https://oribaka.github.io/soricia/?admin=1` một lần. Trình duyệt sẽ nhớ chế độ này.
- Mở link gốc `https://oribaka.github.io/soricia/` sau đó vẫn thấy đủ nút quản lý trên máy bạn.
- Để tắt trên máy đó: mở `?admin=0`.

Đây là chế độ ẩn giao diện, không phải đăng nhập bảo mật: ai biết tham số cũng bật được, nhưng họ chỉ sửa được dữ liệu trong **trình duyệt của họ**, không đổi được web chung hay repo GitHub.

1. Vào website ở chế độ chủ web, bấm nút **Quản lý** ở góc trên (hoặc **+ Thêm bài hát** / **+ Thêm anime** trong từng mục).
2. Điền thông tin: tên, nghệ sĩ/tên phụ, thể loại (gõ thể loại mới tuỳ thích), điểm 0–10, năm, số tập, trạng thái và ghi chú.
3. Chọn ảnh bìa/poster nếu có — ảnh tự động nén trước khi lưu.
4. Bấm **Thêm** hoặc **Lưu thay đổi**. Nút **✎ Sửa / ✕ Xoá** luôn hiện trên từng bài/anime — bấm **✎ Sửa** để đổi điểm, ghi chú hoặc thêm ảnh cho mục đã có.

Dữ liệu được lưu trong **trình duyệt của thiết bị đó** (`localStorage`). Ảnh bìa có sẵn trong `data/data.js` **không** bị nhét lại vào bộ nhớ trình duyệt (web chỉ lưu một mã tham chiếu), nên không bị lỗi “bộ nhớ đầy” vì 17 ảnh gốc. Ảnh bạn tự tải lên vẫn được lưu và có thể chiếm chỗ — nếu lưu quá nhiều ảnh lớn, hãy tải file JSON về rồi xoá bớt. Để mang sang thiết bị khác hoặc đưa lên GitHub, mở tab **Dữ liệu**:

- **Tải file JSON**: sao lưu / nhập lại ở thiết bị khác.
- **Tải file data.js**: thay nội dung `data/data.js` trên GitHub, commit/push để mọi người đều thấy danh sách mới.
- **Khôi phục dữ liệu gốc**: quay lại nội dung hiện trong `data/data.js`.

Sau khi push lên `main`, GitHub Pages tự build lại trong vài phút. Nếu vẫn thấy bản cũ, mở `https://oribaka.github.io/soricia/?new=1` hoặc ép tải lại (`Ctrl+Shift+R` / `Cmd+Shift+R`).

## Đồng bộ từ Google Drive

Bạn có thể để file `data.js` trên Google Drive và nhắn mình cập nhật. Mình đọc file, thay `data/data.js`, commit/merge rồi kiểm tra lại web.

`data.js` nên có trường `version` (mốc thời gian). Khi phiên bản mới lên web, dữ liệu trong repo sẽ thắng dữ liệu đang lưu trong trình duyệt; bản cũ đã lưu được giữ lại và có thể khôi phục bằng nút **Khôi phục bản cũ trong trình duyệt** trong tab **Dữ liệu**. Nếu bạn tự sửa trên web sau đó, bản đó vẫn được giữ cho đến lần `data.js` tiếp theo thay đổi.

Ảnh trong `data.js` có thể là `data:image/...` (đã nén) hoặc URL `https://` công khai; ảnh chỉ nằm riêng trong Drive sẽ không tải được trên web công khai.

## Bình chọn của người xem (Firebase Realtime Database)

Khách bấm vào ô chấm điểm (ô text lớn, hiện bàn phím số trên điện thoại), gõ điểm 1–10 (có thể lẻ như `8.5` hoặc `8,5`) rồi bấm **Gửi**. Web hiển thị **điểm trung bình cộng đồng** ở trên và **điểm của tác giả** bên dưới. Mỗi trình duyệt có một mã ngẫu nhiên nên chỉ một phiếu cho mỗi bài, nhưng **có thể gửi lại để sửa điểm** bất kỳ lúc nào — nút sẽ đổi thành **Sửa**.

Cài đặt một lần:

1. Tạo project miễn phí tại https://console.firebase.google.com (gói Spark).
2. Vào **Build → Realtime Database → Create database**.
3. Vào tab **Rules**, thay toàn bộ nội dung bằng file [`firebase/rules.json`](firebase/rules.json) rồi bấm **Publish**.
4. Giữ nguyên Database URL trong `data/config.js`:

```js
window.SITE_CONFIG = {
  firebaseUrl: "https://soricia-default-rtdb.firebaseio.com",
  votesPath: "votes"
};
```

5. Commit/push lên `main`. Nếu `firebaseUrl` để trống, web vẫn chạy và chỉ hiện điểm tác giả.

Rules chỉ cho phép khách đọc bảng `votes` và ghi số từ 1–10 vào từng lượt chấm; không cho xoá hoặc ghi dữ liệu ngoài phạm vi đó. URL database là thông tin công khai, không phải secret.

## Nghe nhạc ngay trên web

Mỗi bài có nút **▶ Nghe**: bấm mở trình phát YouTube dạng cửa sổ nhỏ góc màn hình, nhạc chạy ngay mà **vẫn cuộn trang, gõ điểm và vote được**. Kéo bằng thanh tiêu đề (có ký hiệu ⠿) để đặt cửa sổ nhạc ở bất cứ đâu; vị trí được nhớ lại sau khi tải lại trang. Nút **⤢** phóng to full màn hình, **🗕** thu nhỏ lại về vị trí đã kéo, **✕** đóng; phím Esc thu nhỏ rồi đóng. Link được lưu trong trường `youtube` của từng bài trong `data/data.js` (45/45 bài). Chủ web có thể dán link mới vào ô **Link YouTube** trong form Sửa/Thêm rồi lưu; chấp nhận cả `https://youtu.be/...`, `youtube.com/watch?v=...` hoặc ID 11 ký tự.

YouTube có thể chặn nhúng ở một số video/quốc gia; nút **Mở YouTube ↗** luôn có sẵn làm phương án dự phòng. Web chỉ nhúng video, không tải hoặc lưu file nhạc có bản quyền.

## Cấu trúc dữ liệu trong `data/data.js`

```js
window.SITE_DATA = {
  profile: { name: "Soricia" },
  songs: [
    { title: "Tên bài", artist: "Nghệ sĩ", genre: "Phonk", score: 10,
      year: 2025, note: "Cảm nghĩ", image: "assets/covers/ten-bai.jpg",
      youtube: "gIYb014up6g" }
  ],
  anime: [
    { title: "Tên anime", genre: "Drama", score: 9, year: 2018,
      episodes: 13, status: "Đã xem", note: "Cảm nghĩ", image: "assets/poster.jpg" }
  ]
};
```

- `score` thang 0–10; `rank` có thể thêm nếu muốn giữ thứ hạng riêng.
- `status`: `"Đã xem"` hoặc `"Đang xem"`.
- `image` tuỳ chọn: đường dẫn/local hoặc URL `https://`. Khi thêm trên web, ảnh được lưu dạng nén trong trình duyệt.

Chạy thử locally:

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc

```
index.html            Trang chính + bảng quản lý
assets/css/style.css  Giao diện, ảnh thumbnail, bảng quản lý
assets/js/app.js      Render, lọc, lưu trình duyệt, nén ảnh, xuất/nhập
data/data.js          Dữ liệu khởi tạo (seed)
data/config.js        Cấu hình Firebase Realtime Database
firebase/rules.json   Quyền cho khách vote (dán vào Firebase → Rules)
```
