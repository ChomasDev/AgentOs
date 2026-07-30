function run(argv) {
  const appName = argv[0];
  const targetIndex = Number(argv[1]);
  const operation = argv[2];
  const argument = argv[3];
  const maxDepth = Number(argv[4]);
  const maxElements = Number(argv[5]);
  const systemEvents = Application("System Events");
  const process = systemEvents.applicationProcesses.byName(appName);

  if (!process.exists()) {
    throw new Error(`Application process "${appName}" is not running`);
  }

  function read(getter) {
    try {
      const value = getter();
      return value === undefined || value === null ? null : value;
    } catch (_) {
      return null;
    }
  }

  let seen = 0;
  let target = null;

  function visit(element, depth) {
    if (target || seen >= maxElements) return;
    const elementIndex = seen;
    seen += 1;
    if (elementIndex === targetIndex) {
      target = element;
      return;
    }
    if (depth >= maxDepth) return;
    const children = read(() => element.uiElements()) || [];
    if (!Array.isArray(children)) return;
    for (const child of children) {
      visit(child, depth + 1);
      if (target || seen >= maxElements) return;
    }
  }

  for (const window of process.windows()) {
    visit(window, 0);
    if (target || seen >= maxElements) break;
  }

  if (!target) {
    throw new Error(
      `Element index ${targetIndex} was not found. Fetch a fresh app state and retry with its elementIndex.`,
    );
  }

  const role = read(() => target.role());
  const subrole = read(() => target.subrole());
  const title = read(() => target.title());
  const actionNames =
    read(() => target.actions().map((action) => action.name())) || [];

  if (operation === "set_value") {
    target.value = argument;
    delay(0.05);
    const actual = read(() => target.value());
    const secure =
      subrole === "AXSecureTextField" ||
      String(role).toLowerCase().includes("secure");
    return JSON.stringify({
      operation,
      elementIndex: targetIndex,
      role,
      subrole,
      title,
      set: true,
      verified: String(actual) === argument,
      value: secure ? "[redacted]" : actual,
    });
  }

  const requestedAction = argument || "AXPress";
  const aliases =
    requestedAction === "AXPress"
      ? ["AXPress", "Press"]
      : [requestedAction];
  const actions = target.actions();
  const action = actions.find((candidate) =>
    aliases.includes(String(candidate.name())),
  );
  if (!action) {
    throw new Error(
      `Element ${targetIndex} does not expose ${requestedAction}. Available actions: ${actionNames.join(", ") || "none"}`,
    );
  }
  action.perform();
  return JSON.stringify({
    operation,
    elementIndex: targetIndex,
    role,
    subrole,
    title,
    performed: String(action.name()),
  });
}
