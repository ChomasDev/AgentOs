function run(argv) {
  const operation = argv[0];
  const name = argv[1];

  if (operation === "list") {
    const processes = Application("System Events").applicationProcesses
      .whose({ backgroundOnly: false })();
    return JSON.stringify(
      processes.map((process) => ({
        name: process.name(),
        frontmost: process.frontmost(),
        visible: process.visible(),
      })),
    );
  }

  const app = Application(name);
  if (operation === "focus") {
    app.activate();
  } else {
    app.quit();
  }
  return JSON.stringify({ app: name, operation });
}
