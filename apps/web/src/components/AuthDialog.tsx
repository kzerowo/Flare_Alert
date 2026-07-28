"use client";

import { useState } from "react";

type Mode = "login" | "signup";

interface Props {
  mode: Mode;
  onClose: () => void;
}

/**
 * 로그인 / 회원가입 화면.
 *
 * 아직 동작하지 않는다. 인증에는 서버와 저장소가 필요한데 둘 다 정해지지
 * 않았다. 되는 척하는 가짜 로그인을 붙이면 나중에 통째로 걷어내야 하고,
 * 그 사이에 "로그인했는데 데이터가 없어진다"는 더 나쁜 경험이 된다.
 *
 * 지금은 무엇을 만들 것인지 보여주는 자리표시자다.
 */
export function AuthDialog({ mode, onClose }: Props) {
  const [current, setCurrent] = useState<Mode>(mode);

  const isLogin = current === "login";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-flare-muted/20 bg-flare-surface p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {isLogin ? "로그인" : "회원가입"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-flare-muted hover:text-flare-accent"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="mt-5 space-y-3">
          <input
            type="email"
            placeholder="이메일"
            disabled
            className="w-full rounded-lg border border-flare-muted/20 bg-flare-bg px-3 py-2 text-sm outline-none"
          />
          <input
            type="password"
            placeholder="비밀번호"
            disabled
            className="w-full rounded-lg border border-flare-muted/20 bg-flare-bg px-3 py-2 text-sm outline-none"
          />
          {isLogin ? null : (
            <input
              type="password"
              placeholder="비밀번호 확인"
              disabled
              className="w-full rounded-lg border border-flare-muted/20 bg-flare-bg px-3 py-2 text-sm outline-none"
            />
          )}
        </div>

        <button
          type="button"
          disabled
          className="mt-4 w-full cursor-not-allowed rounded-lg bg-flare-accent/40 px-4 py-2 text-sm font-medium text-flare-bg"
        >
          {isLogin ? "로그인" : "가입하기"}
        </button>

        <p className="mt-3 rounded-lg border border-flare-muted/20 p-3 text-xs leading-relaxed text-flare-muted">
          아직 준비 중입니다. 계정을 만들면 채널이 계정에 저장되어 앱에서도
          이어서 쓸 수 있고, 텔레그램 알림도 켤 수 있게 됩니다.
          <br />
          <br />
          지금은 로그인 없이 그대로 쓰셔도 됩니다. 만든 채널은 이 탭이 열려
          있는 동안 유지됩니다.
        </p>

        <button
          type="button"
          onClick={() => setCurrent(isLogin ? "signup" : "login")}
          className="mt-4 w-full text-center text-xs text-flare-muted hover:text-flare-accent"
        >
          {isLogin
            ? "계정이 없으신가요? 회원가입"
            : "이미 계정이 있으신가요? 로그인"}
        </button>
      </div>
    </div>
  );
}
