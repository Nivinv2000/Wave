let controller = null;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "init") {
      const url = URL.createObjectURL(
        new Blob([m.source], { type: "text/javascript" }),
      );
      try {
        const module = await import(url);
        if (typeof module.createController !== "function")
          throw new Error("Export createController(options) from the module");
        controller = await module.createController(m.options ?? {});
        if (typeof controller?.step !== "function")
          throw new Error("createController must return { step(observation) }");
      } finally {
        URL.revokeObjectURL(url);
      }
      self.postMessage({ id: m.id, ok: true, result: "ready" });
    } else if (m.type === "step") {
      if (!controller) throw new Error("Controller is not initialized");
      const result = await controller.step(m.observation);
      self.postMessage({ id: m.id, ok: true, result });
    }
  } catch (error) {
    self.postMessage({
      id: m.id,
      ok: false,
      error: String(error?.message ?? error),
    });
  }
};
