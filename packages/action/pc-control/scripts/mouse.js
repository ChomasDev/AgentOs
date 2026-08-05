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

  if (operation === "drag") {
    const toX = Number(argv[3]);
    const toY = Number(argv[4]);
    const durationMs = Number(argv[5]);
    const steps = Number(argv[6]);
    const buttonName = argv[7];
    const button = mouseButton(buttonName);
    const eventTypes = dragEventTypes(buttonName);

    $.CGWarpMouseCursorPosition(point);
    const down = $.CGEventCreateMouseEvent(
      null,
      eventTypes.down,
      point,
      button,
    );
    $.CGEventPost($.kCGHIDEventTap, down);

    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      const nextPoint = $.CGPointMake(
        x + (toX - x) * progress,
        y + (toY - y) * progress,
      );
      const dragged = $.CGEventCreateMouseEvent(
        null,
        eventTypes.dragged,
        nextPoint,
        button,
      );
      $.CGEventPost($.kCGHIDEventTap, dragged);
      if (durationMs > 0) {
        delay(durationMs / steps / 1000);
      }
    }

    const destination = $.CGPointMake(toX, toY);
    const up = $.CGEventCreateMouseEvent(
      null,
      eventTypes.up,
      destination,
      button,
    );
    $.CGEventPost($.kCGHIDEventTap, up);
    return JSON.stringify({
      fromX: x,
      fromY: y,
      toX,
      toY,
      button: buttonName,
      durationMs,
      steps,
    });
  }

  const buttonName = argv[3];
  const clicks = Number(argv[4]);
  const button = mouseButton(buttonName);
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

function mouseButton(buttonName) {
  return buttonName === "right"
    ? $.kCGMouseButtonRight
    : buttonName === "center"
      ? $.kCGMouseButtonCenter
      : $.kCGMouseButtonLeft;
}

function dragEventTypes(buttonName) {
  if (buttonName === "right") {
    return {
      down: $.kCGEventRightMouseDown,
      dragged: $.kCGEventRightMouseDragged,
      up: $.kCGEventRightMouseUp,
    };
  }
  if (buttonName === "center") {
    return {
      down: $.kCGEventOtherMouseDown,
      dragged: $.kCGEventOtherMouseDragged,
      up: $.kCGEventOtherMouseUp,
    };
  }
  return {
    down: $.kCGEventLeftMouseDown,
    dragged: $.kCGEventLeftMouseDragged,
    up: $.kCGEventLeftMouseUp,
  };
}
