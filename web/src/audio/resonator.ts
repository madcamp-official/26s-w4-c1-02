/**
 * 리조네이터 뱅크 — .inst 의 (f, d) + 탭 지점 진폭으로 소리를 낸다.
 *
 * 구현 방침 (D1 확정):
 * - OscillatorNode + GainNode, setTargetAtTime 지수 감쇠
 *   (바이쿼드+임펄스보다 디버깅 쉬움)
 * - 터치 → 소리 30ms 이내가 필수 제약. AudioContext 를 사전에 resume 하고
 *   touchstart 기준으로 발화할 것 (touchend 아님).
 */

import type { Inst } from "../inst/types";

export class ResonatorBank {
  private ctx: AudioContext;
  private inst: Inst;
  /** 반음 단위 음정 시프트. 모든 모드에 같은 비율을 곱해 음색 보존 */
  pitchShiftSemitones = 0;

  constructor(ctx: AudioContext, inst: Inst) {
    this.ctx = ctx;
    this.inst = inst;
  }

  /**
   * 첫 사용자 제스처에서 반드시 호출 — 모바일 오디오 언락.
   * 이걸 빼먹으면 iOS/Android 에서 소리가 안 난다.
   */
  async unlock(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  /** 탭 발화: 모드별 진폭(amps)으로 감쇠 사인파들을 울린다. */
  trigger(amps: number[], velocity = 1): void {
    const now = this.ctx.currentTime;
    const ratio = Math.pow(2, this.pitchShiftSemitones / 12);
    const master = this.inst.playback.master_gain;

    this.inst.modes.forEach((mode, i) => {
      const a = amps[i] * velocity * master;
      if (a <= 0.001) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.value = mode.f * ratio;
      gain.gain.setValueAtTime(a, now);
      // 지수 감쇠: 시정수 = 1/d
      gain.gain.setTargetAtTime(0, now, 1 / mode.d);

      osc.connect(gain).connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 5 / mode.d + 0.1);
    });
  }

  // TODO(D3): 누르기 = 음소거 (강한 모드의 감쇠 상승)
  // TODO(D3): 문지르기 = 노이즈 지속 입력 (속도=강도, 위치=음색)
  // TODO(D3): 반음 스냅 튜닝 (기본 주파수만 스냅, 상위 모드 비율 유지)
}
