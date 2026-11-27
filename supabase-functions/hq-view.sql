-- Lets SOS HQ remember, on the member's account, which side she uses:
-- 'dc' = content only, 'biz' = business only, 'both' = everything.
-- Optional. Without it HQ remembers the choice on each device instead. Run once in the Supabase SQL editor.
alter table public.members add column if not exists track text;
alter table public.members drop constraint if exists members_track_check;
alter table public.members add constraint members_track_check check (track is null or track in ('dc','biz','both'));
