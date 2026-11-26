# Soricia — nhạc & anime của tôi

Trang web cá nhân gồm hai trang riêng: `index.html` (nhạc) và `anime.html` (anime), dùng chung CSS/JS, dữ liệu và bảng quản lý.
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
2. Điền thông tin: tên, nghệ sĩ/tên phụ, thể loại (gõ thể loại mới tuỳ thích; một anime có thể có nhiều thể loại, cách nhau bằng dấu phẩy như `Action, Drama, Mecha`), điểm 0–10, năm, số tập, trạng thái và ghi chú. Bộ lọc anime sẽ tách từng thể loại để lọc riêng.
3. Chọn ảnh bìa/poster nếu có — ảnh tự động nén trước khi lưu. Với anime, bấm **✦ Tìm poster gợi ý** để lấy ảnh từ Jikan theo tên anime, rồi đổi sang ảnh khác nếu muốn.
4. Bấm **Thêm** hoặc **Lưu thay đổi**. Nút **✎ Sửa / ✕ Xoá** luôn hiện trên từng bài/anime — bấm **✎ Sửa** để đổi điểm, ghi chú hoặc thêm ảnh cho mục đã có. Sau khi xoá, toast hiện nút **Hoàn tác** trong 8 giây để khôi phục.

Dữ liệu được lưu trong **trình duyệt của thiết bị đó** (`localStorage`). Ảnh bìa có sẵn nằm riêng trong `assets/covers/` và `data/data.js` chỉ giữ đường dẫn tới file. Ảnh bạn tự tải lên được cất trong **IndexedDB**, localStorage chỉ giữ mã `idb:<key>` nên không vướng hạn mức ~5MB; khi đẩy lên Firebase hoặc xuất file thì ảnh được nhét lại thành `data:image/...` đầy đủ. Để mang sang thiết bị khác hoặc đưa lên GitHub, mở tab **Dữ liệu**:

- **Tải file JSON**: sao lưu / nhập lại ở thiết bị khác.
- **Tải file data.js**: thay nội dung `data/data.js` trên GitHub, commit/push để mọi người đều thấy danh sách mới. Nếu file từ Drive còn nhét ảnh base64, chạy `node tools/extract-covers.js` để tách ảnh sang `assets/covers/` trước khi commit. File xuất ra tự gắn mốc `version` mới, nên người xem cũ sẽ tự lấy bản mới thay vì dùng dữ liệu đã lưu trong trình duyệt.
- **Thêm hàng loạt**: dán nhiều dòng `Tên | Nghệ sĩ | YouTube | Thể loại` (nhạc) hoặc `Tên | Tên phụ | Thể loại | Năm | Số tập` (anime), bấm **Xem trước** rồi **Thêm**. Dòng trùng tên tự động bỏ qua.
- **Khôi phục dữ liệu gốc**: quay lại nội dung hiện trong `data/data.js`.

Sau khi push lên `main`, GitHub Pages tự build lại trong vài phút. Nếu vẫn thấy bản cũ, mở `https://oribaka.github.io/soricia/?new=1` hoặc ép tải lại (`Ctrl+Shift+R` / `Cmd+Shift+R`).

## Đồng bộ từ Google Drive

Bạn có thể để file `data.js` trên Google Drive và nhắn mình cập nhật. Mình đọc file, thay `data/data.js`, commit/merge rồi kiểm tra lại web.

`data.js` nên có trường `version` (mốc thời gian). Khi phiên bản mới lên web, dữ liệu trong repo sẽ thắng dữ liệu đang lưu trong trình duyệt; bản cũ đã lưu được giữ lại và có thể khôi phục bằng nút **Khôi phục bản cũ trong trình duyệt** trong tab **Dữ liệu**. Nếu bạn tự sửa trên web sau đó, bản đó vẫn được giữ cho đến lần `data.js` tiếp theo thay đổi.

Ảnh trong `data.js` có thể là `data:image/...` (đã nén) hoặc URL `https://` công khai; ảnh chỉ nằm riêng trong Drive sẽ không tải được trên web công khai.

## Tự động cập nhật lên web (không cần sửa file / nhắn mình)

Sau khi cấu hình, mỗi lần **Thêm / Sửa / Xoá** trong bảng Quản lý sẽ ghi thẳng lên Firebase. Khách truy cập thấy dữ liệu mới ngay, không cần commit `data.js` hay đợi Pages build.

### Thiết lập 1 lần trong Firebase Console
1. **Authentication → Sign-in method** → bật **Email/Password**.
2. **Authentication → Users → Add user** → tạo tài khoản chủ web (email + mật khẩu). Nhớ email này.
3. **Project settings → Your apps → Web app** → copy **Web API key** (giá trị này public, không phải secret).
4. **Realtime Database → Rules**: trong `firebase/rules.json`, thay `THAY_EMAIL_CHU_WEB@example.com` bằng email ở bước 2, rồi dán toàn bộ nội dung file vào tab Rules → **Publish**.
5. Điền Web API key vào `data/config.js`, trường `authApiKey` (hoặc nhắn mình để mình điền và commit). Chưa điền thì web vẫn chạy chế độ lưu trong trình duyệt như cũ.

### Ảnh: không cần trả phí (mặc định)
Firebase Storage yêu cầu nâng cấp project lên **Blaze (thanh toán)** — web này **không yêu cầu** và vẫn chạy miễn phí với Realtime Database. Mặc định `storageBucket: ""` trong `data/config.js`: ảnh bạn thêm được lưu trong **IndexedDB của trình duyệt**, còn danh sách (kèm đường dẫn ảnh) vẫn đồng bộ qua Firebase miễn phí.

Lưu ý: ảnh trong IndexedDB chỉ hiển thị trên **thiết bị đã thêm ảnh đó**. Để ảnh hiển thị với mọi người, gửi file `data.js` (có ảnh base64) cho mình qua Drive, mình sẽ trích xuất vào `assets/covers/` và đăng lên web — cách này không tốn phí.

Nếu sau này bạn bật Blaze: tạo bucket Storage, vào Storage → Rules dán `firebase/storage.rules` → **Publish**, rồi điền tên bucket vào `storageBucket` trong `data/config.js`. Ảnh mới sẽ tự đẩy lên `covers/...`; nếu upload lỗi thì vẫn rơi về IndexedDB.

### Nhóm A — chắc chắn trước khi mở rộng
- Trong tab **Dữ liệu** của bảng quản lý có nút **📦 Gói cập nhật cho Drive**: tải về file zip gồm `data.js` + các ảnh bìa **Regina tự thêm** (đã nén JPEG tối đa 1200px) + `README.txt`. Regina chỉ cần gửi zip này qua Google Drive, Lucia giải nén đè vào repo là ảnh hiển thị public, không cần Storage trả phí.
- Cũng trong tab **Dữ liệu**, nút **Chạy kiểm tra** báo trạng thái đọc công khai, số mục trên web/Firebase, lần đồng bộ cuối và thử ghi một key tạm để xác nhận Rules đã Publish và đúng email chủ web. Key tạm tự xoá ngay sau khi thử.
- Khi có người đăng dữ liệu mới trong lúc bảng quản lý đang mở, một banner **“Có dữ liệu mới…”** hiện lên; bấm **Tải bản mới** sẽ lấy bản đó sau khi xác nhận (tránh đè mất thay đổi chưa lưu).

### Cách dùng
- Mở `https://oribaka.github.io/soricia/index.html?admin=1` (hoặc `anime.html?admin=1`) → bảng Quản lý hiện ô **Đăng nhập chủ web**.
- Đăng nhập xong thì thêm/sửa/xoá như trước. Mỗi thay đổi được đẩy lên node `collection` trên Firebase kèm `version` mới, nên mọi trình duyệt tự lấy bản mới.
- Lần đầu, bấm **Đăng danh sách hiện tại lên web** để đẩy dữ liệu bạn đang có lên Firebase.
- Khách bình thường không cần `?admin=1`: họ chỉ thấy nút vote và dữ liệu mới nhất. Đăng xuất bằng nút **Đăng xuất** trong bảng Quản lý.

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

## Hai chế độ xem bài hát

Phần Âm nhạc có 2 tab:

- **Bảng xếp hạng**: xếp theo **điểm trung bình vote cộng đồng** (mặc định), hiện điểm trung bình, điểm của tác giả và ô chấm điểm. Mỗi bài có số hạng riêng `#01`, `#02`… (không chia sẻ hạng). Các bài cùng điểm được xếp ngẫu nhiên với nhau; thứ tự ngẫu nhiên này được lưu trong trình duyệt để không đổi mỗi lần tải lại. Có thể đổi kiểu sắp xếp bằng ô “Sắp xếp bài hát”. Cạnh bộ lọc thể loại có thêm 3 chip **Tất cả / Đã vote / Chưa vote** (kèm số bài), dùng được ở cả hai tab; tab Vote còn có thanh tiến độ “Bạn đã chấm X/Y bài”. Sau khi gửi điểm, bài đó vẫn hiện lại tại chỗ để bạn kịp xem điểm, cho đến khi đổi bộ lọc.
- **Vote nhạc**: ẩn điểm cộng đồng, điểm tác giả, thanh điểm và ô thống kê điểm trung bình. Mỗi bài chỉ hiện ô chấm 1–10; sau khi bạn bấm **Gửi**, bài đó mới lộ điểm trung bình, điểm tác giả và cho phép **Sửa** điểm. Các bài chưa chấm vẫn giấu điểm. Tab này tự sắp theo thứ hạng có sẵn để không lộ điểm qua thứ tự sắp xếp; quay lại **Bảng xếp hạng** sẽ khôi phục kiểu sắp xếp cũ.

Phần Anime dùng **cùng cơ chế 2 tab** (`Bảng xếp hạng` / `Vote anime`): xếp theo điểm vote cộng đồng, số hạng riêng `#01`, cùng điểm thì trộn ngẫu nhiên, chip lọc **Tất cả / Đã vote / Chưa vote**, và tab Vote giấu điểm + sao cho đến khi bạn gửi phiếu. Phiếu anime được lưu riêng (`anime-<tên bộ>`) trên Firebase nên không lẫn với phiếu bài hát.

Ngoài chip thể loại, anime có thêm chip lọc **Tất cả / Đã xem / Đang xem**. Mục mới thêm trong vòng 7 ngày có nhãn **MỚI**. Mỗi bài/anime có nút **🔗 Chia sẻ** để copy link dạng `#item=anime:<tên>` — mở link sẽ cuộn tới đúng mục. Khi chế độ Firebase đang bật, web kiểm tra phiên bản dữ liệu mỗi 30 giây và tự lấy bản mới mà không cần tải lại trang (kể cả khi bạn đang mở tab cũ).

## Nghe nhạc ngay trên web

Mỗi bài có nút **▶ Nghe**: bấm mở trình phát YouTube dạng cửa sổ nhỏ góc màn hình, nhạc chạy ngay mà **vẫn cuộn trang, gõ điểm và vote được**. Kéo bằng thanh tiêu đề (có ký hiệu ⠿) để đặt cửa sổ nhạc ở bất cứ đâu; vị trí được nhớ lại sau khi tải lại trang. Nút **⤢** phóng to full màn hình, **🗕** thu nhỏ lại về vị trí đã kéo, **✕** đóng; phím Esc thu nhỏ rồi đóng. Link được lưu trong trường `youtube` của từng bài trong `data/data.js` (77/77 bài). Chủ web có thể dán link mới vào ô **Link YouTube** trong form Sửa/Thêm rồi lưu; chấp nhận cả `https://youtu.be/...`, `youtube.com/watch?v=...` hoặc ID 11 ký tự.

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
index.html            Trang âm nhạc + bảng quản lý dùng chung
anime.html            Trang anime + bảng quản lý dùng chung
assets/css/style.css  Giao diện, ảnh thumbnail, bảng quản lý
assets/js/app.js      Render, lọc, lưu trình duyệt, nén ảnh, xuất/nhập
data/data.js          Dữ liệu khởi tạo (seed, chỉ chứa đường dẫn ảnh)
assets/covers/        Ảnh bìa/poster tách riêng khỏi data.js
data/config.js        Cấu hình Firebase Realtime Database
tools/extract-covers.js  Tách ảnh base64 sang assets/covers/ sau mỗi lần sync data.js
firebase/rules.json   Quyền cho khách vote (dán vào Firebase → Rules)
```
