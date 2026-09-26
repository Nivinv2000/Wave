// Deliberate failure fixture: the worker must terminate this controller.
export function createController() {
  return {
    step() {
      while (true) {}
    },
  };
}
