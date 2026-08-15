import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MEMBERSHIP,
  FREE_CHANNEL_LIMIT,
  canCreateChannel,
  channelLimit,
  effectivePlan,
  isPlan,
  isUserRole,
  toMembership,
} from "./plan.js";
import type { Membership } from "./plan.js";

const NOW = Date.UTC(2026, 7, 16);

function member(overrides: Partial<Membership> = {}): Membership {
  return { ...DEFAULT_MEMBERSHIP, ...overrides };
}

describe("effectivePlan", () => {
  it("무료 계정은 무료다", () => {
    assert.equal(effectivePlan(member(), NOW), "free");
  });

  it("만료 없는 pro는 pro다", () => {
    assert.equal(effectivePlan(member({ plan: "pro" }), NOW), "pro");
  });

  it("만료 시각이 남았으면 아직 pro다", () => {
    const m = member({ plan: "pro", planExpiresAt: NOW + 1000 });
    assert.equal(effectivePlan(m, NOW), "pro");
  });

  // 만료를 무시하면 결제가 끊긴 뒤에도 무제한으로 남는다.
  it("만료 시각이 지났으면 무료로 되돌아간다", () => {
    const m = member({ plan: "pro", planExpiresAt: NOW - 1 });
    assert.equal(effectivePlan(m, NOW), "free");
  });

  it("경계(만료 시각 정각)는 만료로 본다", () => {
    const m = member({ plan: "pro", planExpiresAt: NOW });
    assert.equal(effectivePlan(m, NOW), "free");
  });

  // 관리자는 요금제와 무관하게 전 기능을 쓴다. 0006의 effective_plan()도
  // role을 먼저 본다 — 두 곳이 어긋나면 관리자가 화면에서만 무제한이 된다.
  it("관리자는 free로 저장돼 있어도 pro다", () => {
    assert.equal(effectivePlan(member({ role: "admin" }), NOW), "pro");
  });

  it("관리자는 만료된 pro여도 pro다", () => {
    const m = member({ role: "admin", plan: "pro", planExpiresAt: NOW - 1 });
    assert.equal(effectivePlan(m, NOW), "pro");
  });
});

describe("channelLimit", () => {
  it("무료는 FREE_CHANNEL_LIMIT다", () => {
    assert.equal(channelLimit(member(), NOW), FREE_CHANNEL_LIMIT);
  });

  // 무제한을 큰 숫자로 바꾸지 않는다. 화면이 "무제한"과 "999개"를
  // 다르게 그려야 하는데, 숫자로 만들면 그 구분이 사라진다.
  it("pro는 null(무제한)이다", () => {
    assert.equal(channelLimit(member({ plan: "pro" }), NOW), null);
  });

  it("관리자는 null(무제한)이다", () => {
    assert.equal(channelLimit(member({ role: "admin" }), NOW), null);
  });
});

describe("canCreateChannel", () => {
  it("무료는 한도 직전까지 허용한다", () => {
    assert.equal(canCreateChannel(member(), FREE_CHANNEL_LIMIT - 1, NOW), true);
  });

  it("무료는 한도에 닿으면 거절한다", () => {
    assert.equal(canCreateChannel(member(), FREE_CHANNEL_LIMIT, NOW), false);
  });

  // 강등으로 한도를 넘긴 채널이 남을 수 있다(0006 admin_set_plan 주석).
  // 그 상태에서도 "더 만들 수 있다"고 답하면 안 된다.
  it("이미 한도를 넘겨도 거절한다", () => {
    assert.equal(canCreateChannel(member(), FREE_CHANNEL_LIMIT + 5, NOW), false);
  });

  it("pro는 개수와 무관하게 허용한다", () => {
    assert.equal(canCreateChannel(member({ plan: "pro" }), 500, NOW), true);
  });
});

describe("toMembership", () => {
  it("모르는 값은 무료/일반으로 떨어진다", () => {
    const m = toMembership({ plan: "platinum", role: "root" });
    assert.deepEqual(m, DEFAULT_MEMBERSHIP);
  });

  it("빈 입력도 기본값이 된다", () => {
    assert.deepEqual(toMembership({}), DEFAULT_MEMBERSHIP);
  });

  it("아는 값은 그대로 통과한다", () => {
    const m = toMembership({ plan: "pro", role: "admin", planExpiresAt: NOW });
    assert.deepEqual(m, { plan: "pro", role: "admin", planExpiresAt: NOW });
  });

  it("숫자가 아닌 만료 시각은 null이 된다", () => {
    assert.equal(toMembership({ planExpiresAt: "2026-08-16" }).planExpiresAt, null);
    assert.equal(toMembership({ planExpiresAt: Number.NaN }).planExpiresAt, null);
  });
});

describe("판별 함수", () => {
  it("isPlan", () => {
    assert.equal(isPlan("free"), true);
    assert.equal(isPlan("pro"), true);
    assert.equal(isPlan("admin"), false);
    assert.equal(isPlan(null), false);
  });

  it("isUserRole", () => {
    assert.equal(isUserRole("user"), true);
    assert.equal(isUserRole("admin"), true);
    assert.equal(isUserRole("pro"), false);
  });
});

describe("기본값", () => {
  // 프로필을 읽는 짧은 사이에 무제한으로 보이면, 그때 만든 채널이 저장
  // 단계에서 거절당한다. 모르는 동안은 가장 좁은 쪽으로 가정한다.
  it("모르는 상태는 무료로 가정한다", () => {
    assert.equal(effectivePlan(DEFAULT_MEMBERSHIP, NOW), "free");
    assert.equal(channelLimit(DEFAULT_MEMBERSHIP, NOW), FREE_CHANNEL_LIMIT);
  });
});
