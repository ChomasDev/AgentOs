ObjC.import("ApplicationServices");

function run() {
  const prompt = $.NSDictionary.dictionaryWithObjectForKey(
    $.NSNumber.numberWithBool(true),
    $.kAXTrustedCheckOptionPrompt,
  );
  const accessibility = Boolean($.AXIsProcessTrustedWithOptions(prompt));
  return JSON.stringify({ accessibility });
}
