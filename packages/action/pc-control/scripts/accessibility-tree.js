function run(argv) {
  const appName = argv[0];
  const maxDepth = Number(argv[1]);
  const maxElements = Number(argv[2]);
  const systemEvents = Application("System Events");
  const process = systemEvents.applicationProcesses.byName(appName);

  if (!process.exists()) {
    throw new Error(`Application process "${appName}" is not running`);
  }

  let seen = 0;
  let truncated = false;

  function normalize(value) {
    if (
      value === undefined ||
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value === undefined ? null : value;
    }
    return String(value);
  }

  function read(getter) {
    try {
      const value = getter();
      if (value === undefined || value === null) return null;
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        return value;
      }
      if (Array.isArray(value)) return value.map(normalize);
      return String(value);
    } catch (_) {
      return null;
    }
  }

  function inspect(element, depth) {
    if (seen >= maxElements) {
      truncated = true;
      return null;
    }
    const elementIndex = seen;
    seen += 1;

    const node = {
      elementIndex,
      role: read(() => element.role()),
      subrole: read(() => element.subrole()),
      name: read(() => element.name()),
      title: read(() => element.title()),
      description: read(() => element.description()),
      value: read(() => element.value()),
      enabled: read(() => element.enabled()),
      focused: read(() => element.focused()),
      position: read(() => element.position()),
      size: read(() => element.size()),
      actions: read(() => element.actions().map((action) => action.name())),
      children: [],
    };

    if (depth < maxDepth && seen < maxElements) {
      const children = read(() => element.uiElements()) || [];
      if (Array.isArray(children)) {
        for (const child of children) {
          const item = inspect(child, depth + 1);
          if (item) node.children.push(item);
          if (seen >= maxElements) break;
        }
      }
    }
    return node;
  }

  const windows = process.windows();
  return JSON.stringify({
    app: appName,
    frontmost: read(() => process.frontmost()),
    windows: windows.map((window) => inspect(window, 0)).filter(Boolean),
    elementCount: seen,
    truncated,
  });
}
