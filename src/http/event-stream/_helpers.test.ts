import { describe, expect, it, vi, afterEach } from "vitest";
import type { RunEvent } from "../../types/run.js";
import { createDeltaBuffer } from "./_helpers.js";

function makeController() {
  const chunks: Uint8Array[] = [];
  const ctrl = {
    enqueue(chunk: Uint8Array) {
      chunks.push(chunk);
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { ctrl, chunks };
}

function parseFrames(chunks: Uint8Array[]): Array<{ event: string; data: unknown }> {
  const raw = chunks.map((c) => new TextDecoder().decode(c)).join("");
  const blocks = raw.split("\n\n").filter((b) => b.trim().length > 0);

  return blocks.map((block) => {
    const lines = block.split("\n");
    const eventLine = lines.find((l) => l.startsWith("event: ")) ?? "event: message";
    const dataLine = lines.find((l) => l.startsWith("data: ")) ?? "data: null";

    return {
      event: eventLine.slice("event: ".length),
      data: JSON.parse(dataLine.slice("data: ".length)),
    };
  });
}

function emitText(onEvent: (event: RunEvent) => void, delta: string, turn = 1): void {
  onEvent({ kind: "text_delta", delta, turn });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createDeltaBuffer", () => {
  it("does not flush on comma/space micro chunks and coalesces on trailing timer", () => {
    vi.useFakeTimers();
    const { ctrl, chunks } = makeController();
    const { onEvent } = createDeltaBuffer(ctrl);

    emitText(onEvent, "This sentence starts");
    emitText(onEvent, ",");
    emitText(onEvent, " and keeps going");
    emitText(onEvent, " ");

    expect(chunks.length).toBe(0);

    vi.advanceTimersByTime(151);

    const frames = parseFrames(chunks);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe("run.text.delta");
    expect((frames[0]?.data as { delta: string }).delta).toBe("This sentence starts, and keeps going ");
  });

  it("flushes buffered text before non-text events to preserve ordering", () => {
    const { ctrl, chunks } = makeController();
    const { onEvent } = createDeltaBuffer(ctrl);

    emitText(onEvent, "buffered text");

    onEvent({
      kind: "turn_end",
      turn: 1,
      usage: { prompt: 1, completion: 1, total: 2 },
    });

    const frames = parseFrames(chunks);
    expect(frames).toHaveLength(2);
    expect(frames[0]?.event).toBe("run.text.delta");
    expect(frames[1]?.event).toBe("run.status");
  });

  it("flushes immediately when max buffer size is reached", () => {
    const { ctrl, chunks } = makeController();
    const { onEvent } = createDeltaBuffer(ctrl);

    emitText(onEvent, "x".repeat(600));

    const frames = parseFrames(chunks);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe("run.text.delta");
    expect((frames[0]?.data as { delta: string }).delta.length).toBe(600);
  });
});
