-- Chạy toàn bộ nội dung này trong Supabase Dashboard → SQL Editor → New query.
-- Bảng lưu mỗi lượt chấm của khách (1 lượt / bài / trình duyệt).

create extension if not exists pgcrypto;

create table if not exists public.song_votes (
  id uuid primary key default gen_random_uuid(),
  song_id text not null,
  score int not null check (score between 1 and 10),
  voter_token text not null,
  created_at timestamptz not null default now(),
  unique (song_id, voter_token)
);

create index if not exists song_votes_song_id_idx on public.song_votes (song_id);

alter table public.song_votes enable row level security;

-- Khách có thể gửi điểm mới.
drop policy if exists "Anyone can submit a vote" on public.song_votes;
create policy "Anyone can submit a vote"
  on public.song_votes for insert to anon
  with check (true);

-- Web cần đọc các lượt chấm để tính điểm trung bình.
drop policy if exists "Anyone can read votes" on public.song_votes;
create policy "Anyone can read votes"
  on public.song_votes for select to anon
  using (true);

-- Không cấp policy UPDATE/DELETE cho anon: khách không sửa hoặc xoá điểm của người khác.
