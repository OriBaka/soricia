# Soricia — nhạc & anime của tôi

Trang web cá nhân để xếp hạng bài hát theo thể loại và ghi điểm những bộ anime đã xem.
Chạy hoàn toàn bằng HTML/CSS/JavaScript tĩnh, không cần cài đặt hay build.

**Website:** https://oribaka.github.io/soricia/

> Nếu website chưa tải được, cần bật GitHub Pages **một lần duy nhất**:
> vào `Settings → Pages → Build and deployment → Source → Deploy from a branch`,
> chọn `main` / `/(root)` rồi bấm `Save`. Sau đó trang tự cập nhật mỗi lần push.

## Cập nhật danh sách

Sửa [`data/data.js`](data/data.js) — đây là file duy nhất chứa nội dung:

```js
window.SITE_DATA = {
  profile: { name: "Soricia" },
  songs: [
    { title: "Tên bài", artist: "Nghệ sĩ", genre: "Pop", score: 9.5, year: 2024, note: "Cảm nghĩ" }
  ],
  anime: [
    { title: "Tên anime", genre: "Drama", score: 9, year: 2018, episodes: 13,
      status: "Đã xem", note: "Cảm nghĩ" }
  ]
};
```

- `score` thang điểm 0–10, `rank` có thể thêm nếu bạn muốn giữ thứ hạng riêng.
- `status`: `"Đã xem"` hoặc `"Đang xem"` (có thể tuỳ ghi chú).
- Thêm/xoá bao nhiêu mục tuỳ thích; giao diện, bộ lọc thể loại và thống kê tự cập nhật.
- Commit rồi push lên `main` là GitHub Pages tự triển khai lại trong vài phút.

Chạy thử locally:

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc

```
index.html          Trang chính
assets/css/style.css  Giao diện (giao diện sáng/tối, responsive)
assets/js/app.js      Lọc, sắp xếp, tìm kiếm, thống kê
data/data.js          Dữ liệu bài hát và anime — sửa ở đây
```

> Dữ liệu hiện tại là **mẫu** để bạn thấy cách trình bày. Hãy thay bằng danh sách
> bài hát và anime thật của bạn trong `data/data.js`.
