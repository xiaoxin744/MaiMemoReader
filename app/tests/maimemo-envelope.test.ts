import { describe, it, expect, vi, afterEach } from "vitest";
import { TokenConnector, fetchTodaySnapshot } from "../src/api/maimemo";

// Real MaiMemo API envelopes, captured live on 2026-11-13: business data is
// wrapped in `data`; progress finished was 110, study_time 2611134 ms.
const progressPayload = {
  success: true,
  errors: [],
  data: { progress: { finished: 110, total: 100, study_time: 2611134 } },
};
const itemsPayload = {
  success: true,
  errors: [],
  data: {
    today_items: [
      { voc_id: "v1", voc_spelling: "specialty", order: 101, first_response: "STUDY_RESPONSE_UNSPECIFIED", is_new: true, is_finished: false },
      { voc_id: "v2", voc_spelling: "subtle", order: 1, first_response: "FAMILIAR", is_new: false, is_finished: true },
      { voc_id: "v3", voc_spelling: "click", order: 2, first_response: "FORGET", is_new: false, is_finished: true },
    ],
  },
};

function stubFetch() {
  return vi.fn(async (url: string) => {
    const body = String(url).includes("get_study_progress") ? progressPayload : itemsPayload;
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("real MaiMemo envelope parsing", () => {
  it("test() reads finished=110 from data.progress", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const c = new TokenConnector("faketoken");
    const r = await c.test("");
    expect(r.ok).toBe(true);
    expect(r.progress?.finished).toBe(110);
    expect(r.progress?.total).toBe(100);
  });

  it("fetchTodaySnapshot parses data.today_items into words", async () => {
    vi.stubGlobal("fetch", stubFetch());
    const c = new TokenConnector("faketoken");
    const snap = await fetchTodaySnapshot(c, "");
    expect(snap.progress?.finished).toBe(110);
    expect(snap.words).toHaveLength(3);
    expect(snap.words[0].spelling).toBe("specialty");
    expect(snap.words[0].isNew).toBe(true);
    expect(snap.words[1].isFinished).toBe(true);
    expect(snap.words[1].response).toBe("FAMILIAR");
  });
});
