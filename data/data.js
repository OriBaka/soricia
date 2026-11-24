/**
 * DỮ LIỆU CÁ NHÂN — sửa file này để cập nhật trang web.
 *
 * songs[]: title, artist, genre, score (0-10), year, note, rank (tuỳ chọn)
 * anime[]: title, alt (tên khác, tuỳ chọn), genre, score (0-10), year,
 *          episodes, status ("Đã xem" | "Đang xem"), note, rank (tuỳ chọn)
 *
 * Điểm là cảm nhận cá nhân; thứ tự hiển thị mặc định theo điểm cao nhất.
 * Thêm/xoá mục tuỳ thích — bộ lọc thể loại và thống kê tự cập nhật.
 */
window.SITE_DATA = {
  profile: {
    name: "Soricia",
    tagline: "Những bản nhạc và thế giới tôi ở lại."
  },
  songs: [
    { title: "Amor Na Praia", artist: "Flame Runner", genre: "Phonk", score: 10 },
    { title: "Voce Na Mira Jumpstyle", artist: "SXILWIX", genre: "Phonk", score: 9 },
    { title: "Sinos De Natal", artist: "mgd", genre: "Phonk", score: 7.5 },
    { title: "AURA", artist: "Ogryzek", genre: "Phonk", score: 10 }
  ],
  anime: []
};
