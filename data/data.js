/**
 * DỮ LIỆU CÁ NHÂN — sửa file này để cập nhật trang web.
 *
 * songs[]: title, artist, genre, score (0-10), year, note, rank (tuỳ chọn)
 * anime[]: title, alt (tên khác, tuỳ chọn), genre, score (0-10), year,
 *          episodes, status ("Đã xem" | "Đang xem"), note, rank (tuỳ chọn)
 *
 * Điểm là cảm nhận cá nhân; thứ tự hiển thị mặc định theo điểm cao nhất.
 * Các dưới đây là dữ liệu mẫu — hãy thay bằng danh sách nghe/xem thật của bạn.
 */
window.SITE_DATA = {
  profile: {
    name: "Soricia",
    tagline: "Những bản nhạc và thế giới tôi ở lại."
  },
  songs: [
    { title: "Đừng nói gì", artist: "Đen Vâu", genre: "Hip-hop", score: 9.8, year: 2021, rank: 1, note: "Nghe lại đúng lúc mình cần một cú tự nhắc nhở. Câu hát còn hơn cả một lời an ủi." },
    { title: "Có chút", artist: "Vũ.", genre: "Pop", score: 9.7, year: 2023, rank: 2, note: "Giai điệu tối giản mà dính mãi, kiểu bài bật lên là cả ngày đều chậm lại." },
    { title: "Như những ngày", artist: "Sơn Tùng M-TP", genre: "Pop", score: 9.4, year: 2023, rank: 3, note: "Một bản pop sáng, sạch và rất hợp để đi bộ buổi sớm." },
    { title: "Chuyện cũ", artist: "Hà Anh Tuấn", genre: "Ballad", score: 9.5, year: 2020, rank: 4, note: "Giọng hát khiến căn phòng như nhỏ lại. Nghe đêm khuya là khó cầm nước mắt." },
    { title: "Cảm ơn vì đã từng", artist: "Đức Phúc", genre: "Ballad", score: 9.1, year: 2022, rank: 5, note: "Ca khúc mình hay gửi cho những người đã đi qua một đoạn đời." },
    { title: "Ngày mai", artist: "MIC", genre: "Rock", score: 9.3, year: 2020, rank: 6, note: "Guitar mở đầu là lý do tôi ở lại nghe đến tận đoạn cuối." },
    { title: "Đi giữa trời rực rỡ", artist: "Thanh Bùi", genre: "Rock", score: 8.8, year: 2021, rank: 7, note: "Một cú hơi kiểu cũ mà vẫn rất trẻ. Bật to vừa đủ để quên deadline." },
    { title: "Sài Gòn today", artist: "Bân", genre: "Indie", score: 9.2, year: 2019, rank: 8, note: "Nghe là thấy phố phường hiện ra, kể cả khi mình đang ở rất xa." },
    { title: "Mùa khác", artist: "Đen Vâu", genre: "Hip-hop", score: 9.0, year: 2022, rank: 9, note: "Lời rap kể chuyện không cần lên gân vẫn chạm." },
    { title: "Anh đừng về", artist: "Chillies", genre: "Indie", score: 8.6, year: 2018, rank: 10, note: "Giai điệu hơi buồn nhưng rất dễ nghe lúc nắng đang lên." },
    { title: "Tìm", artist: "Hồ Hoài Anh", genre: "R&B", score: 8.9, year: 2024, rank: 11, note: "Chill, mượt và có chút lặng lẽ — đúng thứ tôi cần sau giờ làm." },
    { title: "Tay anh", artist: "Vũ Cát Tường", genre: "R&B", score: 8.7, year: 2022, rank: 12, note: "Phần hòa âm làm bài này khác hẳn những bản ballad cùng dòng." },
    { title: "Đi tìm điều còn sót lại", artist: "Hoàng Dũng", genre: "Pop", score: 8.9, year: 2023, rank: 13, note: "Một bài pop tử tế: không cầu kỳ mà vẫn có hậu vị." },
    { title: "Nhịp tim", artist: "Khoai Lang Thang", genre: "Electronic", score: 8.5, year: 2024, rank: 14, note: "Bass chạy đều, hợp để viết khi cần giữ nhịp tập trung." },
    { title: "Lạc lối", artist: "On:ra", genre: "Electronic", score: 8.3, year: 2023, rank: 15, note: "Khá tối nhưng rất gợi, nhất là khi nghe bằng tai nghe." },
    { title: "Một triệu lý do", artist: "Hà Anh Tuấn", genre: "Ballad", score: 8.6, year: 2019, rank: 16, note: "Cách hát kể chuyện khiến mình ngồi yên hẳn để nghe từng chữ." },
    { title: "Sau tất cả", artist: "Léquip", genre: "Hip-hop", score: 8.2, year: 2023, rank: 17, note: "Flow nhẹ, hook dính — một bản rap dễ nghe cho ngày dài." },
    { title: "Và tôi vẫn hát", artist: "Trịnh Bảo Trọng", genre: "Indie", score: 8.4, year: 2022, rank: 18, note: "Có vẻ mộc mạc nhưng ý nhạc rất chắc." },
    { title: "Yêu mình nhiều hơn", artist: "Suni Hạ Linh", genre: "R&B", score: 8.1, year: 2024, rank: 19, note: "Bản nhạc tự chữa lành kiểu nhẹ nhàng, không cần lời quá nhiều." },
    { title: "Một đêm nữa", artist: "Bức Tường", genre: "Rock", score: 8.0, year: 2018, rank: 20, note: "Chất rock cũ mà vẫn có chỗ trong playlist hiện đại của tôi." },
    { title: "Late Night Drive", artist: "Various Artists", genre: "Electronic", score: 7.9, year: 2024, rank: 21, note: "Không lời, chỉ nhịp — rất hợp làm nhạc nền lúc làm việc." },
    { title: "Là mình", artist: "Đức Trí", genre: "Pop", score: 7.8, year: 2021, rank: 22, note: "Một bản pop ổn để bật trong xe trên đường về nhà." },
    { title: "Cát", artist: "Ngọc Anh", genre: "OST", score: 9.3, year: 2022, rank: 23, note: "Nhạc phim hay đến mức mình mở lại ngay sau khi xem xong phim." },
    { title: "Về nhà", artist: "Minh Kha", genre: "OST", score: 8.8, year: 2023, rank: 24, note: "Giai điệu dịu dàng, mỗi lần nghe lại nhớ một cảnh phim cũ." }
  ],
  anime: [
    { title: "Violet Evergarden", genre: "Drama", score: 9.8, year: 2018, episodes: 13, status: "Đã xem", rank: 1, note: "Từng tập như một bức thư gửi người mình từng yêu. Đẹp theo cả nghĩa hình ảnh lẫn cảm xúc." },
    { title: "Frieren: Beyond Journey's End", alt: "Frieren: Sau hành trình", genre: "Fantasy", score: 9.7, year: 2023, episodes: 28, status: "Đã xem", rank: 2, note: "Nhịp kể chậm mà không hề buồn. Những khoảng lặng ở đây có ý nghĩa hơn cả trận đấu." },
    { title: "Steins;Gate", genre: "Sci-Fi", score: 9.6, year: 2011, episodes: 24, status: "Đã xem", rank: 3, note: "Nửa đầu hài hước, nửa sau nghẹt thở. Một trong những cú twist khiến mình ngồi im hồi lâu." },
    { title: "Fullmetal Alchemist: Brotherhood", genre: "Action", score: 9.6, year: 2009, episodes: 64, status: "Đã xem", rank: 4, note: "Gần như không có tập yếu. Xem xong vẫn muốn bắt đầu lại từ tập một." },
    { title: "Spirited Away", alt: "Sen và Chihiro ở thế giới thần linh", genre: "Fantasy", score: 9.5, year: 2001, episodes: 1, status: "Đã xem", rank: 5, note: "Mỗi lần xem lại lại thấy một chi tiết mới. Đẹp và hơi sợ theo cách rất riêng của Ghibli." },
    { title: "Your Name", alt: "Kimi no Na wa", genre: "Drama", score: 9.4, year: 2016, episodes: 1, status: "Đã xem", rank: 6, note: "Âm nhạc và hình ảnh cùng kể một câu chuyện mà lời thoại không kể nổi." },
    { title: "K-On!", genre: "Slice of Life", score: 9.1, year: 2009, episodes: 24, status: "Đã xem", rank: 7, note: "Không có biến cố lớn, chỉ là bốn cô gái và một câu lạc bộ — mà xem mãi không chán." },
    { title: "Hunter × Hunter", genre: "Action", score: 9.2, year: 1999, episodes: 148, status: "Đã xem", rank: 8, note: "Dài nhưng đáng. Phần thi đấu và các mối quan hệ nhân vật đều mang lại nhiều hơn mong đợi." },
    { title: "March comes in like a lion", alt: "Sangatsu no Lion", genre: "Slice of Life", score: 9.0, year: 2016, episodes: 22, status: "Đã xem", rank: 9, note: "Một bộ anime về cờ shogi mà lại nói rất thật về cô đơn và chữa lành." },
    { title: "Cyberpunk: Edgerunners", genre: "Sci-Fi", score: 8.9, year: 2022, episodes: 10, status: "Đã xem", rank: 10, note: "Mười tập, không một phút thừa. Nhạc nền và màu sắc làm nên một cú kết khó quên." },
    { title: "The Melancholy of Haruhi Suzumiya", genre: "Comedy", score: 8.7, year: 2006, episodes: 14, status: "Đã xem", rank: 11, note: "Hài hước, lập dị và có những khoảnh khắc bất ngờ rất nghiêm túc." },
    { title: "A Silent Voice", alt: "Koe no Katachi", genre: "Drama", score: 9.3, year: 2016, episodes: 1, status: "Đã xem", rank: 12, note: "Một bộ phim về lỗi lầm, xin lỗi và việc học cách nhìn lại chính mình." },
    { title: "Demon Slayer", genre: "Action", score: 8.6, year: 2019, episodes: 26, status: "Đã xem", rank: 13, note: "Acting và chuyển động rất đẹp, đúng kiểu xem một hơi cho đã mắt." },
    { title: "Vinland Saga", genre: "Action", score: 8.5, year: 2023, episodes: 24, status: "Đang xem", rank: 14, note: "Nhịp kể chậm hơn phần đầu nhưng sâu hơn nhiều; đang xem dần để thấm từng tập." },
    { title: "Odd Taxi", genre: "Mystery", score: 8.8, year: 2021, episodes: 13, status: "Đã xem", rank: 15, note: "Tưởng là những câu chuyện rời rạc, hóa ra mọi mảnh ghép đều khớp lại." }
  ]
};
