-- Add bounded Windows accessibility discovery to the outbound device relay.
alter table public.mcpos_device_commands
  drop constraint if exists mcpos_device_commands_command_check;
alter table public.mcpos_device_commands
  add constraint mcpos_device_commands_command_check
  check (command in ('desktop.status', 'screen.capture', 'desktop.accessibility'));

notify pgrst, 'reload schema';
