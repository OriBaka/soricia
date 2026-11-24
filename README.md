# Soricia — nhạc & anime của tôi

Trang web cá nhân để xếp hạng bài hát theo thể loại và ghi điểm những bộ anime đã xem.
Chạy hoàn toàn bằng HTML/CSS/JavaScript tĩnh, không cần cài đặt hay build.

**Website:** https://oribaka.github.io/soricia/

> Nếu website chưa tải được, cần bật GitHub Pages **một lần duy nhất**:
> vào `Settings → Pages → Build and deployment → Source → Deploy from a branch`,
> chọn `main` / `/(root)` rồi bấm `Save`.

## Thêm/sửa ngay trên web

1. Vào website, bấm nút **Quản lý** ở góc trên (hoặc **+ Thêm bài hát** / **+ Thêm anime** trong từng mục).
2. Điền thông tin: tên, nghệ sĩ/tên phụ, thể loại (gõ thể loại mới tuỳ thích), điểm 0–10, năm, số tập, trạng thái và ghi chú.
3. Chọn ảnh bìa/poster nếu có — ảnh tự động nén trước khi lưu.
4. Bấm **Thêm** hoặc **Lưu thay đổi**. Nút **✎ Sửa / ✕ Xoá** luôn hiện trên từng bài/anime — bấm **✎ Sửa** để đổi điểm, ghi chú hoặc thêm ảnh cho mục đã có.

Dữ liệu được lưu trong **trình duyệt của thiết bị đó** (`localStorage`). Để mang sang thiết bị khác hoặc đưa lên GitHub, mở tab **Dữ liệu**:

- **Tải file JSON**: sao lưu / nhập lại ở thiết bị khác.
- **Tải file data.js**: thay nội dung `data/data.js` trên GitHub, commit/push để mọi người đều thấy danh sách mới.
- **Khôi phục dữ liệu gốc**: quay lại nội dung hiện trong `data/data.js`.

Sau khi push lên `main`, GitHub Pages tự build lại trong vài phút. Nếu vẫn thấy bản cũ, mở `https://oribaka.github.io/soricia/?new=1` hoặc ép tải lại (`Ctrl+Shift+R` / `Cmd+Shift+R`).

## Đồng bộ từ Google Drive

Bạn có thể để file `data.js` trên Google Drive và nhắn mình cập nhật. Mình đọc file, thay `data/data.js`, commit/merge rồi kiểm tra lại web.

`data.js` nên có trường `version` (mốc thời gian). Khi phiên bản mới lên web, dữ liệu trong repo sẽ thắng dữ liệu đang lưu trong trình duyệt; bản cũ đã lưu được giữ lại và có thể khôi phục bằng nút **Khôi phục bản cũ trong trình duyệt** trong tab **Dữ liệu**. Nếu bạn tự sửa trên web sau đó, bản đó vẫn được giữ cho đến lần `data.js` tiếp theo thay đổi.

Ảnh trong `data.js` có thể là `data:image/...` (đã nén) hoặc URL `https://` công khai; ảnh chỉ nằm riêng trong Drive sẽ không tải được trên web công khai.

## Bình chọn của người xem (Supabase)

Khách có thể chấm điểm 1–10 cho từng bài. Web hiển thị **điểm trung bình của cộng đồng** ở trên và **điểm của tác giả** bên dưới. Mỗi trình duyệt chỉ được chấm một lần cho mọi bài (có thể đổi bằng cách xoá localStorage).

Cài đặt một lần:

1. Tạo project miễn phí tại https://supabase.com.
2. Vào **SQL Editor → New query**, dán toàn bộ nội dung `supabase/setup.sql` rồi bấm Run.
3. Vào **Project Settings → API**, lấy **Project URL** và **anon/public key**.
4. Điền vào `data/config.js`:

```js
window.SITE_CONFIG = {
  supabaseUrl: "https://xxxx.supabase.co",
  supabaseAnonKey: "eyJ..."
};
```

5. Commit/push lên `main`. Khi hai giá trị còn trống, web vẫn chạy bình thường và chỉ hiện điểm của tác giả.

anon key là khoá công khai dùng được trong trình duyệt — **không dùng service_role key**. Chính sách RLS trong file SQL chỉ cho phép khách tạo và đọc lượt chấm, không cho sửa/xoá.

## Cấu trúc dữ liệu trong `data/data.js`

```js
window.SITE_DATA = {
  profile: { name: "Soricia" },
  songs: [
    { title: "Tên bài", artist: "Nghệ sĩ", genre: "Phonk", score: 10,
      year: 2025, note: "Cảm nghĩ", image: "assets/covers/ten-bai.jpg" }
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
```
