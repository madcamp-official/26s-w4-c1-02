import type { Inst } from "./types";

/** .inst JSON 을 불러와 최소 검증 후 반환한다. */
export async function loadInst(url: string): Promise<Inst> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load .inst: ${res.status}`);
  const inst = (await res.json()) as Inst;
  if (inst.version !== "0.2") throw new Error(`unsupported .inst version: ${inst.version}`);
  for (const anchor of inst.anchors) {
    if (anchor.amps.length !== inst.modes.length) {
      throw new Error("anchor.amps length must match modes length");
    }
  }
  return inst;
}
