on run argv
  set keyName to item 1 of argv
  set modifierList to {}

  if (count of argv) > 1 then
    repeat with modifierName in items 2 thru -1 of argv
      -- `repeat with x in list` binds a reference; coerce before comparing.
      set modifierName to modifierName as text
      if modifierName is "command" or modifierName is "cmd" then
        set end of modifierList to command down
      else if modifierName is "control" or modifierName is "ctrl" then
        set end of modifierList to control down
      else if modifierName is "option" or modifierName is "alt" then
        set end of modifierList to option down
      else if modifierName is "shift" then
        set end of modifierList to shift down
      else
        error "Unknown modifier: " & modifierName
      end if
    end repeat
  end if

  set keyCode to missing value
  if keyName is "return" then
    set keyCode to 36
  else if keyName is "tab" then
    set keyCode to 48
  else if keyName is "space" then
    set keyCode to 49
  else if keyName is "delete" then
    set keyCode to 51
  else if keyName is "escape" then
    set keyCode to 53
  else if keyName is "home" then
    set keyCode to 115
  else if keyName is "page_up" then
    set keyCode to 116
  else if keyName is "end" then
    set keyCode to 119
  else if keyName is "page_down" then
    set keyCode to 121
  else if keyName is "left" then
    set keyCode to 123
  else if keyName is "right" then
    set keyCode to 124
  else if keyName is "down" then
    set keyCode to 125
  else if keyName is "up" then
    set keyCode to 126
  end if

  tell application "System Events"
    if keyCode is missing value then
      keystroke keyName using modifierList
    else
      key code keyCode using modifierList
    end if
  end tell
end run
