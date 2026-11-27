-- Public read-only Storage bucket for ExTrack OTA web bundles (`manifest.json` and `extrack-<version>.zip`).
-- Uploads are restricted to project owners via the Supabase Dashboard or service_role key.
insert into storage.buckets (id, name, public)
values ('app-updates', 'app-updates', true)
on conflict (id) do update set public = true;

drop policy if exists "Public read app updates" on storage.objects;
create policy "Public read app updates"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'app-updates');
