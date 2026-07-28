ObjC.import("ApplicationServices");
ObjC.import("CoreGraphics");

function run() {
  const prompt = $.NSDictionary.dictionaryWithObjectForKey(
    $.NSNumber.numberWithBool(true),
    $.kAXTrustedCheckOptionPrompt,
  );
  const accessibility = Boolean($.AXIsProcessTrustedWithOptions(prompt));
  let screenRecording = null;

  try {
    screenRecording = Boolean($.CGPreflightScreenCaptureAccess());
    if (!screenRecording) {
      screenRecording = Boolean($.CGRequestScreenCaptureAccess());
    }
  } catch (_) {
    // Screen-capture permission APIs are unavailable on older macOS releases.
  }

  return JSON.stringify({ accessibility, screenRecording });
}
