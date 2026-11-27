-- Character sheets in SOS HQ. Run once in the Supabase SQL editor, BEFORE deploying dreamcast v1.3.0.
alter table public.characters add column if not exists sheet_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('character-sheets', 'character-sheets', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "sheets: read own" on storage.objects for select to authenticated
  using (bucket_id = 'character-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "sheets: add own" on storage.objects for insert to authenticated
  with check (bucket_id = 'character-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text and public.is_member());
create policy "sheets: replace own" on storage.objects for update to authenticated
  using (bucket_id = 'character-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'character-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "sheets: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'character-sheets' and (storage.foldername(name))[1] = (select auth.uid())::text);
