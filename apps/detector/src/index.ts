// detector 진입점.
//
// 이 프로세스는 바이낸스 WebSocket에 상시 연결된 채로 돌아간다.
// 서버리스에 올릴 수 없어서 web과 배포를 분리했다 (docs/decisions.md 6번).
//
// 오늘은 골격만 세운다. 아래 파이프라인 각 단계는 다음 세션에서 백테스트와
// 함께 구현한다. 파이프라인 전체 그림은 docs/architecture.md 참고.
//
//   aggTrade WS -> 1초 버킷 -> 프레임별 롤링 창 -> 중앙값/MAD 점수 S
//     -> 퍼센타일 환산 -> 민감도 임계 판정 -> 필터 -> 텔레그램 발송

import { TIMEFRAMES, SENSITIVITY_DEFAULT } from "@flare-alert/core";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("[detector] 시작");
  console.log(`[detector] 감시 프레임: ${TIMEFRAMES.join(", ")}`);
  console.log(`[detector] 기본 민감도: ${SENSITIVITY_DEFAULT}`);
  console.log(`[detector] 로그 레벨: ${config.logLevel}`);

  // TODO: 바이낸스 aggTrade WebSocket 연결 및 재연결 처리
  // TODO: 1초 버킷 집계기 (VolumeAggregator) 부착
  // TODO: 프레임별 롤링 창 평가 루프 (1초 틱)
  // TODO: 중앙값/MAD 기준선 + 점수 계산기 부착
  // TODO: 퍼센타일 추정기 (과거 S 분포) 부착
  // TODO: 필터 체인 (최소 거래대금 / 워밍업 / 쿨다운 / 프레임 병합)
  // TODO: 텔레그램 발송기 부착
  // TODO: 헬스체크 HTTP 서버 (config.port)

  registerShutdownHandlers();

  console.log("[detector] 골격만 로드됨. 감지 로직은 아직 없습니다.");
}

/**
 * 상시 프로세스라서 종료 신호를 직접 처리해야 한다.
 * 재배포 때 WebSocket을 정리하지 않으면 연결이 남아 중복 알림이 나갈 수 있다.
 */
function registerShutdownHandlers(): void {
  const shutdown = (signal: string): void => {
    console.log(`[detector] ${signal} 수신, 종료합니다`);
    // TODO: WebSocket 연결 정리, 진행 중인 발송 대기
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[detector] 부팅 실패", error);
  process.exit(1);
});
