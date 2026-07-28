ObjC.import("ApplicationServices");

function run(argv) {
  const operation = argv[0];
  const x = Number(argv[1]);
  const y = Number(argv[2]);
  const point = $.CGPointMake(x, y);

  if (operation === "move") {
    $.CGWarpMouseCursorPosition(point);
    return JSON.stringify({ x, y });
  }

  const buttonName = argv[3];
  const clicks = Number(argv[4]);
  const button =
    buttonName === "right"
      ? $.kCGMouseButtonRight
      : buttonName === "center"
        ? $.kCGMouseButtonCenter
        : $.kCGMouseButtonLeft;
  const downType =
    buttonName === "right"
      ? $.kCGEventRightMouseDown
      : buttonName === "center"
        ? $.kCGEventOtherMouseDown
        : $.kCGEventLeftMouseDown;
  const upType =
    buttonName === "right"
      ? $.kCGEventRightMouseUp
      : buttonName === "center"
        ? $.kCGEventOtherMouseUp
        : $.kCGEventLeftMouseUp;

  $.CGWarpMouseCursorPosition(point);
  for (let index = 1; index <= clicks; index += 1) {
    const down = $.CGEventCreateMouseEvent(null, downType, point, button);
    $.CGEventSetIntegerValueField(down, $.kCGMouseEventClickState, index);
    $.CGEventPost($.kCGHIDEventTap, down);

    const up = $.CGEventCreateMouseEvent(null, upType, point, button);
    $.CGEventSetIntegerValueField(up, $.kCGMouseEventClickState, index);
    $.CGEventPost($.kCGHIDEventTap, up);
    delay(0.08);
  }

  return JSON.stringify({ x, y, button: buttonName, clicks });
}
