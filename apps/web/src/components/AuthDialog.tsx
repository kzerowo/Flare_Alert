"use client";

import { useState } from "react";

import { Icon } from "./Icon";

type Mode = "login" | "signup";

interface Props {
  mode: Mode;
  onClose: () => void;
}

/**
 * 로그인 / 회원가입.
 *
 * 아직 동작하지 않는다. 인증에는 서버와 저장소가 필요한데 둘 다 정해지지
 * 않았다. 되는 척하는 가짜 로그인을 붙이면 나중에 통째로 걷어내야 하고,
 * 그 사이에 "로그인했는데 데이터가 없어진다"는 더 나쁜 경험이 된다.
 *
 * 시안에 있던 구글 로그인과 API 키 버튼은 뺐다. 붙일 백엔드가 없어서
 * 누르면 아무 일도 일어나지 않는 버튼이 두 개 더 생길 뿐이다.
 * "AES-256 암호화" 같은 문구도 뺐다. 사실이 아니다.
 */
export function AuthDialog({ mode, onClose }: Props) {
  const [current, setCurrent] = useState<Mode>(mode);
  const isLogin = current === "login";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-md backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel w-full max-w-md rounded-xl p-xl shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col items-start">
            <span className="mb-md inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary-container text-on-primary-container">
              <Icon name="bell" size={24} />
            </span>
            <h2 className="text-display">{isLogin ? "로그인" : "회원가입"}</h2>
            <p className="mt-xs text-body-sm text-on-surface-variant">
              채널을 계정에 저장하고 어디서든 이어서 씁니다.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant transition-colors hover:text-primary"
            aria-label="닫기"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <form
          className="mt-xl space-y-lg"
          onSubmit={(event) => event.preventDefault()}
        >
          <div className="space-y-xs">
            <label htmlFor="auth-email" className="label block px-xs">
              이메일
            </label>
            <div className="group relative">
              <span className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                <Icon name="mail" size={18} />
              </span>
              <input
                id="auth-email"
                type="email"
                disabled
                placeholder="name@example.com"
                className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-md text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-xs">
            <label htmlFor="auth-password" className="label block px-xs">
              비밀번호
            </label>
            <div className="group relative">
              <span className="absolute left-md top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors group-focus-within:text-primary">
                <Icon name="lock" size={18} />
              </span>
              <input
                id="auth-password"
                type="password"
                disabled
                placeholder="••••••••"
                className="h-12 w-full rounded-lg border border-outline-variant bg-sunken pl-12 pr-md text-body-sm placeholder:text-outline-variant focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled
            className="label flex h-12 w-full cursor-not-allowed items-center justify-center gap-sm rounded-lg bg-primary-container/40 text-on-primary-container"
          >
            {isLogin ? "로그인" : "가입하기"}
            <Icon name="arrow-right" size={16} />
          </button>
        </form>

        <p className="mt-lg rounded-lg border border-white/5 bg-white/[0.02] p-md text-body-sm leading-relaxed text-on-surface-variant">
          아직 준비 중입니다. 계정이 생기면 채널이 저장되어 앱에서도 이어서 쓸
          수 있고, 텔레그램 알림도 켤 수 있게 됩니다.
          <br />
          <br />
          지금은 로그인 없이 그대로 쓰셔도 됩니다. 만든 채널은 이 탭이 열려
          있는 동안 유지됩니다.
        </p>

        <button
          type="button"
          onClick={() => setCurrent(isLogin ? "signup" : "login")}
          className="mt-lg w-full text-center text-body-sm text-on-surface-variant transition-colors hover:text-primary"
        >
          {isLogin ? (
            <>
              계정이 없으신가요? <b className="text-primary">회원가입</b>
            </>
          ) : (
            <>
              이미 계정이 있으신가요? <b className="text-primary">로그인</b>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
