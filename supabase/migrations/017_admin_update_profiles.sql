-- Allow admins to update any user's profile.
--
-- The original 001_initial_schema.sql restricted UPDATE on `profiles` to the
-- profile owner (`id = auth.uid()`). This silently blocked the admin UI from
-- assigning business_id, role, account flags, etc. to other users — RLS
-- returned "success" with zero rows affected, so the admin form looked like
-- it worked but nothing was persisted.

CREATE POLICY "Admins update any profile"
  ON profiles FOR UPDATE
  USING (is_admin())
  WITH CHECK (is_admin());
