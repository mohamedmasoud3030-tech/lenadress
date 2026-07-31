-- Public (anonymous) read access for the customer-facing /landing page.
--
-- The landing page is meant to be reachable by a visiting customer who has
-- no staff account. Every existing dresses/dress_images policy is scoped to
-- `authenticated` + an active showroom profile, so an anonymous visitor got
-- zero rows back and the page's inventory data was invisible to the very
-- audience it's built for.
--
-- Scope is deliberately narrow: only rows with status = 'available', SELECT
-- only, anon role only. All existing authenticated-staff policies are
-- untouched.

create policy "dresses_select_public_available"
  on public.dresses
  for select
  to anon
  using (status = 'available');

create policy "dress_images_select_public_available"
  on public.dress_images
  for select
  to anon
  using (
    exists (
      select 1 from public.dresses d
      where d.id = dress_images.dress_id
        and d.status = 'available'
    )
  );
