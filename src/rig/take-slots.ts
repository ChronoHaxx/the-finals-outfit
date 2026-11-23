// Where the take machinery meets the viewer's frame loop (22 Nov 2026). The viewer (CharacterViewer's TakeBridge) puts
// in what only it can reach: the probe the recorder samples each frame, and the stage a render drives. The panel puts in
// the recorder while a take records; CaptureDriver calls its sample() once a frame.
import type { TakeProbe, TakeRecorder } from "../lib/take-recorder";
import type { TakeStage } from "./VideoExport";

export const takeSlots: { probe: TakeProbe | null; stage: TakeStage | null; recorder: TakeRecorder | null } =
  { probe: null, stage: null, recorder: null };
