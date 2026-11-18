-- Add one-shot mouse and text-entry actions; each command is held for local approval.
alter table public.mcpos_device_commands
  drop constraint if exists mcpos_device_commands_command_check;
alter table public.mcpos_device_commands
  add constraint mcpos_device_commands_command_check
  check (command in ('desktop.status', 'screen.capture', 'desktop.accessibility', 'files.list', 'files.read', 'input.pointer.click', 'input.keyboard.type'));

notify pgrst, 'reload schema';
