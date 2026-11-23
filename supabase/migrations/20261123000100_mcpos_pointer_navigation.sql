-- Allow the Windows companion's non-destructive pointer navigation and shortcut commands.
alter table public.mcpos_device_commands
  drop constraint if exists mcpos_device_commands_command_check;
alter table public.mcpos_device_commands
  add constraint mcpos_device_commands_command_check
  check (command in (
    'desktop.status', 'screen.capture', 'desktop.accessibility',
    'files.list', 'files.read',
    'input.pointer.click', 'input.pointer.move', 'input.pointer.scroll',
    'input.keyboard.type', 'input.keyboard.shortcut',
    'browser.open', 'browser.snapshot', 'browser.click', 'browser.type'
  ));
notify pgrst, 'reload schema';
