-- One record is one transaction, account, budget or the prefs object: a few hundred bytes. Cap each at
-- 64 KB so a signed-in client can't fill the database through its own rows.
-- `not valid` skips checking existing rows (all far below the cap); new and changed rows are checked.
alter table public.records
  add constraint records_data_size check (data is null or pg_column_size(data) <= 65536) not valid;
