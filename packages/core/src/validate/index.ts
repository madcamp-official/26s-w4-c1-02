// @endpointer/core/validate — 드리프트 검증기 (원칙 ⑤ "스키마가 곧 검증기다")
//
//   drift.ts    기획서 9-3② 의 네 가지 판정 + 사람용 문구 + Gemini 용 치유 프롬프트
//   baseline.ts `runs.validation_json` 에서 비교 기준을 계산 (최근 N회 중앙값)
//   overlap.ts  겹침률 — 치유 승격 관문(9-3③) 과 probe 후보 순위(9-1)
//
// 워커의 정기 수집 한 바퀴는 이 순서로 이 모듈을 쓴다:
//
//   const baseline = baselineFromRuns(recentRuns)
//   const report   = evaluateReport(validation, baseline, collection.schema_json)
//   if (report.verdict !== 'ok') {
//     source.status = 'healing'                      // 이 소스만 격리 (원칙 ④)
//     run.error_summary = report.summary             // 사용자가 읽는다 (B4)
//     const prompt = healPrompt(report.signals, spec) // Gemini 가 읽는다 (9-3③)
//     …재컴파일 후 passesHealGate(prevItems, candidateItems) 로 마지막 확인
//   }

export {
  DRIFT_THRESHOLDS,
  DRIFT_SIGNAL_KINDS,
  resolveThresholds,
  evaluateDrift,
  evaluateReport,
  verdictToRunStatus,
  healPrompt,
  type DriftThresholds,
  type DriftSignal,
  type DriftSignalKind,
  type DriftVerdict,
  type DriftReport,
  type DriftInput,
} from './drift'

export {
  computeBaseline,
  baselineFromRuns,
  seedBaseline,
  hasUsableBaseline,
  median,
  type DriftBaseline,
} from './baseline'

export {
  overlapRatio,
  textOverlapRatio,
  passesHealGate,
  collectComparableValues,
  identityOf,
  normalizeIdentity,
  type OverlapItem,
} from './overlap'
