-- Add read-only operations for folders explicitly selected in the Windows companion.
alter table public.mcpos_device_commands
  drop constraint if exists mcpos_device_commands_command_check;
alter table public.mcpos_device_commands
  add constraint mcpos_device_commands_command_check
  check (command in ('desktop.status', 'screen.capture', 'desktop.accessibility', 'files.list', 'files.read'));

notify pgrst, 'reload schema';
