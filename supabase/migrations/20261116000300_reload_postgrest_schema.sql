-- Refresh PostgREST's schema cache so the service-role-only pairing RPC is discoverable.
notify pgrst, 'reload schema';
