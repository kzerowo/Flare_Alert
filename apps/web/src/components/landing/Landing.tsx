"use client";

import { useState } from "react";

import {
  DEFAULT_SENSITIVITY_LEVEL,
  POPULAR_BINANCE_SYMBOLS,
  displaySymbol,
} from "@flare-alert/core";

import { useT } from "@/lib/i18n";
import { CoinIcon } from "../CoinIcon";
import { Icon } from "../Icon";
import { LanguageToggle } from "../LanguageToggle";
import { SensitivitySlider } from "../SensitivitySlider";
import { LiveTape } from "./LiveTape";
import { ScaleCompare } from "./ScaleCompare";

/*
 * 서비스 소개 페이지.
 *
 * 앱 화면과 어휘를 일부러 다르게 잡았다. 앱은 이미 무엇을 하는 서비스인지
 * 아는 사람이 보는 화면이고, 여기는 "거래대금"이라는 말조차 처음인 사람이
 * 보는 화면이다. 그래서 설명이 아니라 움직이는 예시가 맨 위에 온다.
 *
 * 조절기(SensitivitySlider) 같은 것은 소개용으로 다시 그리지 않고 앱이
 * 쓰는 그 컴포넌트를 그대로 부른다. 소개 화면의 그림과 실제 화면이
 * 어긋나는 순간 소개는 거짓말이 된다.
 */

/** 앱으로 들어가는 주소. 로그인·가입 창을 바로 열고 싶으면 auth를 붙인다. */
const APP_HREF = "/app";
const SIGNUP_HREF = "/app?auth=signup";
const LOGIN_HREF = "/app?auth=login";

/** 민감도 테스트는 채널 만들기 안에 있다. 목록에 떨궈 놓으면 못 찾는다. */
const TEST_HREF = "/app?new=1";

export function Landing() {
  const t = useT();

  return (
    <div className="flex min-h-screen flex-col">
      <LandingHeader />

      <main className="flex-grow">
        <Hero />
        <CoinStrip />
        <Why />
        <How />
        <SliderSection />
        <RatioSection />
        <TestSection />
        <Honest />
        <Pricing />
        <Faq />
        <FinalCall />
      </main>

      <footer className="border-t border-white/5 bg-sunken">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <span className="text-title font-bold">{t.brand}</span>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {t.landing.footer.tagline}
              </p>
            </div>
            <a
              href={APP_HREF}
              className="label text-primary transition-opacity hover:opacity-80"
            >
              {t.landing.footer.app}
            </a>
          </div>
          <p className="mt-6 max-w-3xl text-body-sm text-outline">
            {t.footer.note}
          </p>
        </div>
      </footer>
    </div>
  );
}

function LandingHeader() {
  const t = useT();

  return (
    <header className="sticky top-0 z-40 border-b border-white/5 bg-surface/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-4 md:px-6">
        <a
          href="/"
          className="shrink-0 text-title font-bold text-primary transition-opacity hover:opacity-80 sm:text-headline"
        >
          {t.brand}
        </a>

        {/* 좁은 화면에서는 목차를 감춘다. 로그인·시작 버튼이 먼저다. */}
        <nav className="hidden items-center gap-6 lg:flex">
          <a
            href="#how"
            className="text-body-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            {t.landing.nav.how}
          </a>
          <a
            href="#pricing"
            className="text-body-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            {t.landing.nav.pricing}
          </a>
          <a
            href="#faq"
            className="text-body-sm text-on-surface-variant transition-colors hover:text-primary"
          >
            {t.landing.nav.faq}
          </a>
        </nav>

        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <LanguageToggle />
          <a
            href={LOGIN_HREF}
            className="label shrink-0 whitespace-nowrap px-2 py-2 text-on-surface-variant transition-colors hover:text-primary sm:px-4"
          >
            {t.landing.nav.login}
          </a>
          <a
            href={SIGNUP_HREF}
            className="label shrink-0 whitespace-nowrap rounded-lg bg-primary-container px-3 py-2 font-bold text-on-primary-container transition-all hover:brightness-110 sm:px-6"
          >
            {t.landing.nav.start}
          </a>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  const t = useT();

  return (
    <section className="relative overflow-hidden">
      {/*
        배경 광원. 화면 위쪽에 하늘색 기운만 옅게 깔아 어두운 바탕이
        검은 벽처럼 보이지 않게 한다.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] opacity-60"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, rgba(56,189,248,0.16) 0%, rgba(56,189,248,0) 70%)",
        }}
      />

      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 md:px-6 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-12 lg:py-20">
        <div>
          <p className="label inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-on-surface-variant">
            <span className="h-1.5 w-1.5 rounded-full bg-primary-container" />
            {t.landing.hero.eyebrow}
          </p>

          <h1 className="mt-5 whitespace-pre-line text-display leading-tight sm:text-[44px] sm:leading-[52px] lg:text-[52px] lg:leading-[60px]">
            {t.landing.hero.title}
          </h1>

          <p className="mt-5 max-w-xl text-body text-on-surface-variant">
            {t.landing.hero.body}
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={SIGNUP_HREF}
              className="flex items-center gap-2 rounded-lg bg-primary-container px-6 py-4 font-bold text-on-primary-container transition-all hover:brightness-110"
            >
              {t.landing.hero.start}
              <Icon name="send" size={16} />
            </a>
            <a
              href={APP_HREF}
              className="rounded-lg border border-white/10 px-6 py-4 font-bold text-on-surface transition-colors hover:border-primary/40 hover:text-primary"
            >
              {t.landing.hero.browse}
            </a>
          </div>

          <p className="mt-4 text-body-sm text-outline">
            {t.landing.hero.note}
          </p>
        </div>

        <div>
          <p className="label mb-3 text-on-surface-variant">
            {t.landing.tape.title}
          </p>
          <LiveTape />
        </div>
      </div>
    </section>
  );
}

/** 감시할 수 있는 종목을 한 줄로. 목록이 곧 대답이라 문장이 필요 없다. */
function CoinStrip() {
  return (
    <section className="border-y border-white/5 bg-sunken/60">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-4 py-6 md:px-6">
        {POPULAR_BINANCE_SYMBOLS.map((symbol) => (
          <span
            key={symbol}
            className="flex items-center gap-2 text-body-sm text-on-surface-variant"
          >
            <CoinIcon symbol={symbol} size={18} />
            <span className="font-mono">{displaySymbol(symbol)}</span>
          </span>
        ))}
      </div>
    </section>
  );
}

/** 절 제목. 어디서나 같은 모양이라 한 군데로 모았다. */
function SectionHead({
  badge,
  title,
  body,
  center = false,
}: {
  badge?: string;
  title: string;
  body?: string;
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      {badge === undefined ? null : (
        <p className="label mb-3 text-primary">{badge}</p>
      )}
      <h2 className="text-headline sm:text-display">{title}</h2>
      {body === undefined ? null : (
        <p className="mt-3 text-body text-on-surface-variant">{body}</p>
      )}
    </div>
  );
}

function Why() {
  const t = useT();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
      <SectionHead title={t.landing.why.title} body={t.landing.why.body} />

      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {t.landing.why.items.map((item) => (
          <li key={item.title} className="card rounded-xl p-5 sm:p-6">
            <h3 className="text-title">{item.title}</h3>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              {item.body}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function How() {
  const t = useT();

  return (
    <section
      id="how"
      className="scroll-mt-24 border-y border-white/5 bg-surface-low"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
        <SectionHead title={t.landing.how.title} body={t.landing.how.body} />

        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {t.landing.how.steps.map((step) => (
            <li key={step.step} className="card rounded-xl p-5 sm:p-6">
              <span className="font-mono text-headline text-primary">
                {step.step}
              </span>
              <h3 className="mt-3 text-title">{step.title}</h3>
              <p className="mt-2 text-body-sm text-on-surface-variant">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * 실제 조절기를 그대로 놓는다.
 *
 * 설명용 그림을 따로 그리지 않는 이유는 두 가지다. 첫째, 여기 적히는
 * 빈도는 실측 곡선에서 읽는 값이라 지어낼 수 없다. 둘째, 가입 전에 만져
 * 본 것과 가입 후에 보는 것이 같아야 한다.
 */
function SliderSection() {
  const t = useT();
  const [level, setLevel] = useState(DEFAULT_SENSITIVITY_LEVEL);

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
      <SectionHead
        badge={t.landing.slider.badge}
        title={t.landing.slider.title}
        center
      />

      <div className="panel mx-auto mt-8 max-w-2xl rounded-xl p-5 sm:p-8">
        <SensitivitySlider value={level} onChange={setLevel} />
      </div>
    </section>
  );
}

function RatioSection() {
  const t = useT();

  return (
    <section className="border-y border-white/5 bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
        <SectionHead
          title={t.landing.ratio.title}
          body={t.landing.ratio.body}
          center
        />
        <div className="mx-auto mt-8 max-w-3xl">
          <ScaleCompare />
        </div>
      </div>
    </section>
  );
}

/**
 * 민감도 테스트 소개.
 *
 * 이 서비스의 진입장벽은 사실상 여기 하나다 — "하루 5회"가 많은지 적은지
 * 처음 온 사람은 알 수가 없다. 그래서 랜딩에서 가장 크게 말한다.
 */
function TestSection() {
  const t = useT();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
      <div className="panel overflow-hidden rounded-xl p-6 sm:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <SectionHead
              title={t.landing.test.title}
              body={t.landing.test.body}
            />
            <a
              href={TEST_HREF}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary-container px-6 py-4 font-bold text-on-primary-container transition-all hover:brightness-110"
            >
              {t.landing.test.cta}
              <Icon name="chart" size={16} />
            </a>
          </div>

          <ol className="space-y-3">
            {t.landing.test.steps.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-4 rounded-lg border border-white/5 bg-surface-high/60 px-4 py-4"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-data text-primary">
                  {index + 1}
                </span>
                <span className="text-body-sm">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/**
 * 못 하는 일을 먼저 적는 절.
 *
 * 랜딩에서 한계를 말하는 것은 손해처럼 보이지만, 이 서비스는 방향을
 * 맞히는 물건으로 오해받으면 첫 알림에서 신뢰를 잃는다. 오해를 사서
 * 얻은 가입자는 어차피 남지 않는다.
 */
function Honest() {
  const t = useT();

  return (
    <section className="border-y border-white/5 bg-surface-low">
      <div className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
        <SectionHead title={t.landing.honest.title} />

        <ul className="mx-auto mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
          {t.landing.honest.items.map((item) => (
            <li
              key={item.title}
              className="rounded-xl border border-warm/20 bg-warm/5 p-5 sm:p-6"
            >
              <h3 className="flex items-start gap-2 text-title text-warm">
                <span className="mt-0.5 shrink-0">
                  <Icon name="info" size={18} />
                </span>
                {item.title}
              </h3>
              <p className="mt-2 text-body-sm text-on-surface-variant">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Pricing() {
  const t = useT();

  return (
    <section
      id="pricing"
      className="mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-16 md:px-6"
    >
      <SectionHead
        title={t.landing.pricing.title}
        body={t.landing.pricing.body}
        center
      />

      <div className="mx-auto mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
        {/* 무료 */}
        <div className="card flex flex-col rounded-xl border-primary/30 p-6 sm:p-8">
          <h3 className="text-title">{t.landing.pricing.freeName}</h3>
          <p className="mt-2">
            <span className="font-mono text-display">
              {t.landing.pricing.freePrice}
            </span>
            <span className="text-body-sm text-on-surface-variant">
              {t.landing.pricing.freePeriod}
            </span>
          </p>

          <ul className="mt-6 flex-grow space-y-2">
            {t.landing.pricing.freeItems.map((item) => (
              <li key={item} className="flex items-center gap-2 text-body-sm">
                <span className="text-primary">
                  <Icon name="activity" size={14} />
                </span>
                {item}
              </li>
            ))}
          </ul>

          <a
            href={SIGNUP_HREF}
            className="mt-8 rounded-lg bg-primary-container px-6 py-3 text-center font-bold text-on-primary-container transition-all hover:brightness-110"
          >
            {t.landing.pricing.freeCta}
          </a>
        </div>

        {/* Pro. 결제가 아직 없으므로 버튼이 아니라 안내로 둔다. */}
        <div className="card flex flex-col rounded-xl p-6 sm:p-8">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-title">{t.landing.pricing.proName}</h3>
            <span className="label rounded-full bg-warm/10 px-2 py-1 text-warm">
              {t.landing.pricing.popular}
            </span>
          </div>
          <p className="mt-2">
            <span className="font-mono text-display">
              {t.landing.pricing.proPrice}
            </span>
            <span className="text-body-sm text-on-surface-variant">
              {t.landing.pricing.proPeriod}
            </span>
          </p>

          <ul className="mt-6 flex-grow space-y-2">
            {t.landing.pricing.proItems.map((item) => (
              <li key={item} className="flex items-center gap-2 text-body-sm">
                <span className="text-on-surface-variant">
                  <Icon name="activity" size={14} />
                </span>
                {item}
              </li>
            ))}
          </ul>

          <p className="mt-8 rounded-lg border border-white/5 px-6 py-3 text-center text-body-sm text-on-surface-variant">
            {t.landing.pricing.proCta}
          </p>
          <p className="mt-3 text-body-sm text-outline">
            {t.landing.pricing.proNote}
          </p>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const t = useT();

  return (
    <section
      id="faq"
      className="scroll-mt-24 border-y border-white/5 bg-surface-low"
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-16 md:px-6">
        <SectionHead title={t.landing.faq.title} center />

        <div className="mt-8 space-y-3">
          {t.landing.faq.items.map((item) => (
            <details key={item.q} className="card group rounded-xl px-5 py-4 sm:px-6">
              <summary className="flex list-none items-center justify-between gap-4 text-title">
                {item.q}
                <span className="shrink-0 text-on-surface-variant transition-transform group-open:rotate-45">
                  <Icon name="plus" size={18} />
                </span>
              </summary>
              <p className="mt-3 text-body-sm text-on-surface-variant">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCall() {
  const t = useT();

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-20 text-center md:px-6">
      <h2 className="text-headline sm:text-display">{t.landing.final.title}</h2>
      <a
        href={SIGNUP_HREF}
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary-container px-8 py-4 font-bold text-on-primary-container transition-all hover:brightness-110"
      >
        {t.landing.final.start}
        <Icon name="send" size={16} />
      </a>
    </section>
  );
}
