// detector 진입점.
//
// 이 프로세스는 바이낸스 WebSocket에 상시 연결된 채로 돌아간다.
// 서버리스에 올릴 수 없어서 web과 배포를 분리했다 (docs/decisions.md 6번).
//
// 파이프라인 본체는 service.ts에 있다. 여기서는 부팅, 로그, 헬스체크,
// 종료 처리만 한다.

import { createServer } from "node:http";

import { SENSITIVITY_DEFAULT, percentileToSlider } from "@flare-alert/core";

import { DetectorService } from "./service.js";
import type { LogLevel, Logger } from "./service.js";
import { loadConfig } from "./config.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function makeLogger(threshold: LogLevel): Logger {
  return (level, message) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[threshold]) {
      return;
    }
    const stamp = new Date().toISOString().slice(11, 19);
    console.log(`${stamp} [${level}] ${message}`);
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = makeLogger(config.logLevel);

  log("info", "detector 시작");
  log(
    "info",
    `기본 민감도: ${SENSITIVITY_DEFAULT} (슬라이더 ${percentileToSlider(SENSITIVITY_DEFAULT)})`,
  );

  if (config.supabase === null) {
    log(
      "warn",
      `독립 모드입니다. 사용자 채널을 읽지 않고 ${config.symbols.join(", ")}만 봅니다.`,
    );
  } else {
    log("info", "Supabase에서 사용자 채널을 읽습니다");
  }

  if (config.vapid === null) {
    log("warn", "VAPID 키가 없습니다. 알림은 콘솔로만 나갑니다.");
  }

  const service = new DetectorService(config, log);

  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(service.ready ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(service.snapshot(), null, 2));
      return;
    }
    response.writeHead(404);
    response.end();
  });

  server.listen(config.port, () => {
    log("info", `헬스체크 http://localhost:${config.port}/health`);
  });

  registerShutdownHandlers(() => {
    service.stop();
    server.close();
  }, log);

  await service.start();
  log("info", "실시간 감지 시작");
}

/**
 * 상시 프로세스라서 종료 신호를 직접 처리해야 한다.
 * 재배포 때 WebSocket을 정리하지 않으면 연결이 남아 중복 알림이 나갈 수 있다.
 */
function registerShutdownHandlers(cleanup: () => void, log: Logger): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    log("info", `${signal} 수신, 종료합니다`);
    cleanup();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error("[detector] 부팅 실패", error);
  process.exit(1);
});
