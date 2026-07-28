ObjC.import("ApplicationServices");

function run(argv) {
  const deltaX = Number(argv[0]);
  const deltaY = Number(argv[1]);
  const event = $.CGEventCreateScrollWheelEvent(
    null,
    $.kCGScrollEventUnitPixel,
    2,
    deltaY,
    deltaX,
  );
  $.CGEventPost($.kCGHIDEventTap, event);
  return JSON.stringify({ deltaX, deltaY });
}
