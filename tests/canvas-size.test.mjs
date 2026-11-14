// Regression tests for the canvas-size patch in web/moss_checks.js.
//
// Upstream `inputNumber()` only followed PrimitiveInt / frontend PrimitiveNode,
// so every other size source returned NaN and the canvas silently stayed at its
// default 1088x1920. The patch resolves whatever widget actually carries the
// number, regardless of the node class.
//
// Run with:  node tests/canvas-size.test.mjs

// --- minimal DOM stub -----------------------------------------------------
// web/moss_common.js injects a <style> at module load, which needs a document.
const fakeElement = () => ({
  style: {}, textContent: "", id: "",
  append() {}, appendChild() {}, setAttribute() {},
  addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
});
globalThis.document = {
  getElementById: () => null,
  createElement: fakeElement,
  head: fakeElement(),
  body: fakeElement(),
};

const { inputNumber } = await import(new URL("../web/moss_checks.js", import.meta.url));

// --- tiny LiteGraph node model -------------------------------------------
/**
 * @param {string} cls node class name
 * @param {Record<string, unknown>} widgets widget name -> value
 * @param {string[]} linked input names that are connected
 * @param {Record<string, object>} upstream input name -> source node
 */
function node(cls, widgets = {}, linked = [], upstream = {}) {
  return {
    comfyClass: cls,
    type: cls,
    widgets: Object.entries(widgets).map(([name, value]) => ({ name, value })),
    inputs: linked.map(name => ({ name, link: 1 })),
    getInputNode(slot) {
      return upstream[this.inputs[slot]?.name] ?? null;
    },
  };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = Object.is(actual, expected) || (Number.isNaN(actual) && Number.isNaN(expected));
  if (!ok) failures += 1;
  const shown = Number.isFinite(actual) ? actual : "NaN";
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(56)} ${shown}${ok ? "" : `  (expected ${expected})`}`);
}

console.log("canvas size resolution");
{
  // 1. Core PrimitiveInt, value typed by hand — upstream handled this one too.
  const pi = node("PrimitiveInt", { value: 1536 });
  check("PrimitiveInt.value", inputNumber(node("MOSSLayoutCanvas", {}, ["width"], { width: pi }), "width"), 1536);
}
{
  // 2. comfyui-logic Int — upstream returned NaN here.
  const logic = node("Int", { value: 1536 });
  check("Logic Int.value", inputNumber(node("MOSSLayoutCanvas", {}, ["width"], { width: logic }), "width"), 1536);
}
{
  // 3. ResolutionMasterSimplify publishes width/height widgets — upstream NaN.
  const rm = node("ResolutionMasterSimplify", { width: 1536, height: 1024 });
  const canvas = node("MOSSLayoutCanvas", {}, ["width", "height"], { width: rm, height: rm });
  check("ResolutionMaster width", inputNumber(canvas, "width"), 1536);
  check("ResolutionMaster height", inputNumber(canvas, "height"), 1024);
}
{
  // 4. PixaromaResolution, same widget shape.
  const pr = node("PixaromaResolution", { width: 768, height: 1344 });
  const canvas = node("MOSSLayoutCanvas", {}, ["width", "height"], { width: pr, height: pr });
  check("PixaromaResolution width", inputNumber(canvas, "width"), 768);
  check("PixaromaResolution height", inputNumber(canvas, "height"), 1344);
}
{
  // 5. PrimitiveInt whose own `value` input is wired to a resolution node.
  const rm = node("ResolutionMasterSimplify", { width: 1536, height: 1024 });
  const pi = node("PrimitiveInt", { value: 0 }, ["value"], { value: rm });
  check("PrimitiveInt.value <- ResolutionMaster", inputNumber(node("MOSSLayoutCanvas", {}, ["width"], { width: pi }), "width"), 1536);
}
{
  // 6. Reroute in the middle.
  const pi = node("PrimitiveInt", { value: 1536 });
  const rr = node("Reroute", {}, ["width"], { width: pi });
  check("Reroute <- PrimitiveInt", inputNumber(node("MOSSLayoutCanvas", {}, ["width"], { width: rr }), "width"), 1536);
}
{
  // 7. Nothing wired: fall back to the canvas's own widget.
  check("unlinked canvas widget", inputNumber(node("MOSSLayoutCanvas", { width: 1088, height: 1920 }), "width"), 1088);
}
{
  // 8. A cycle must terminate instead of hanging.
  const a = node("X", {}, ["width"]);
  const b = node("Y", {}, ["width"], { width: a });
  a.getInputNode = () => b;
  check("cyclic reference", inputNumber(node("MOSSLayoutCanvas", {}, ["width"], { width: a }), "width"), NaN);
}
{
  // 9. A source that publishes nothing still yields NaN, not a bogus number.
  const empty = node("SomeNode", { seed: 42 });
  check("unresolvable source", inputNumber(node("MOSSLayoutCanvas", {}, ["width"], { width: empty }), "width"), NaN);
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
