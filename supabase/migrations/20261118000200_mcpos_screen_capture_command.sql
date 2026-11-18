-- Add the first observation capability to the outbound relay.
-- The Windows companion still requires its local consent switch to be ON.
alter table public.mcpos_device_commands
  drop constraint if exists mcpos_device_commands_command_check;
alter table public.mcpos_device_commands
  add constraint mcpos_device_commands_command_check
  check (command in ('desktop.status', 'screen.capture'));

notify pgrst, 'reload schema';
