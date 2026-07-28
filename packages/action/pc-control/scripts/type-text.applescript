on run argv
  tell application "System Events"
    keystroke (item 1 of argv)
  end tell
end run
