"use client";

import Lenis from "lenis";
import Image from "next/image";
import Script from "next/script";
import type { CSSProperties } from "react";
import { createElement, useEffect, useRef, useState } from "react";
import { FlowBentoStage } from "@/components/flow-bentos";

const valueProps = [
  {
    label: "Less collateral",
    title: "Stop overcollateralizing.",
    copy: "CredScore turns reliable credit signals into higher LTV tiers for qualified borrowers.",
    image: "/earn-better-terms/stop-overcollateralizing.png",
  },
  {
    label: "Wallet optional",
    title: "Score beyond a wallet.",
    copy: "Use on-chain history, verified bank records, or both to build a borrower profile.",
    image: "/earn-better-terms/score-beyond-wallet.png",
  },
  {
    label: "Fairer quote",
    title: "Borrow on reputation.",
    copy: "The lending contract reads your score before setting collateral limits and rate premiums.",
    image: "/earn-better-terms/borrow-on-reputation.png",
  },
];

const productFlow = [
  {
    step: "01",
    label: "Proof source",
    title: "Pick your proof",
    copy: "Start with wallet history, verified bank records, or both.",
    note: "Wallet optional",
    image: "/prove-score-borrow/pick-your-proof.png",
  },
  {
    step: "02",
    label: "Scoring",
    title: "Build CredScore",
    copy: "CredFlow turns credit signals into a borrower score.",
    note: "Score preview",
    image: "/prove-score-borrow/build-credscore.png",
  },
  {
    step: "03",
    label: "Borrowing",
    title: "Unlock a quote",
    copy: "Higher tiers can reduce collateral and improve LTV.",
    note: "85% LTV tier",
    image: "/prove-score-borrow/unlock-quote.png",
  },
  {
    step: "04",
    label: "Monitoring",
    title: "Keep it healthy",
    copy: "Agents watch score, loan state, and repayment behavior.",
    note: "Live status",
    image: "/prove-score-borrow/keep-it-healthy.png",
  },
];

const trustItems = [
  {
    title: "Bank-proof boost",
    copy: "Reclaim can verify balance capacity without exposing raw account data.",
    tag: "Optional",
  },
  {
    title: "Score-aware limits",
    copy: "CredFlow maps scores into LTV tiers instead of one blanket collateral rule.",
    tag: "Readable",
  },
  {
    title: "Active monitoring",
    copy: "Repayment, defaults, and health signals update the borrower profile.",
    tag: "Live",
  },
  {
    title: "Cross-chain memory",
    copy: "Scores can move across deployments so good history does not reset.",
    tag: "Synced",
  },
];

const heroWords = ["score", "records", "trust"];

function ClientEffects() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 0.9,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      anchors: false,
    });

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    const getAnchorOffset = () => {
      const header = document.querySelector<HTMLElement>(".nav-shell");
      const headerBottom = header?.getBoundingClientRect().bottom ?? 80;
      const breathingRoom = window.innerWidth < 640 ? 20 : 32;
      return Math.round(headerBottom + breathingRoom);
    };

    const onClick = (event: MouseEvent) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>("a[href^='#']");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href === "#") return;
      const target = document.querySelector<HTMLElement>(href);
      if (!target) return;
      event.preventDefault();
      const targetY = window.scrollY + target.getBoundingClientRect().top - getAnchorOffset();
      lenis.scrollTo(targetY, {
        duration: 0.95,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      });
      history.replaceState(null, "", href);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("is-visible");
        });
      },
      { threshold: 0.22, rootMargin: "0px 0px -12% 0px" }
    );

    document.addEventListener("click", onClick);
    document.querySelectorAll<HTMLElement>("[data-reveal]").forEach((node) => observer.observe(node));

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", onClick);
      observer.disconnect();
      lenis.destroy();
    };
  }, []);

  return null;
}

function HeroCreditNetwork() {
  return (
    <figure className="hero-illustration" aria-label="CredFlow credit network animation">
      {/*
        Keep this deliberately plain: the exported Lottie JSON is loaded directly
        by the LottieFiles web component, without React Lottie wrappers.
      */}
      {createElement("lottie-player", {
        src: "/lotties/hero-lottie.json",
        background: "transparent",
        speed: "1",
        loop: true,
        autoplay: true,
        renderer: "svg",
      })}
    </figure>
  );
}

function HeroTypedWord() {
  const [wordIndex, setWordIndex] = useState(0);
  const [letterCount, setLetterCount] = useState(heroWords[0].length);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = heroWords[wordIndex];
    const doneTyping = !deleting && letterCount === word.length;
    const doneDeleting = deleting && letterCount === 0;
    const delay = doneTyping ? 1100 : doneDeleting ? 180 : deleting ? 52 : 82;

    const timeout = window.setTimeout(() => {
      if (doneTyping) {
        setDeleting(true);
        return;
      }
      if (doneDeleting) {
        setDeleting(false);
        setWordIndex((current) => (current + 1) % heroWords.length);
        return;
      }
      setLetterCount((current) => current + (deleting ? -1 : 1));
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [deleting, letterCount, wordIndex]);

  const visibleWord = heroWords[wordIndex].slice(0, letterCount);

  return (
    <span className="typing-word" aria-live="polite">
      {visibleWord || "\u00a0"}
    </span>
  );
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function FlowExperience() {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const manualIndexRef = useRef<number | null>(null);
  const manualScrollYRef = useRef(0);
  const [progress, setProgress] = useState(0);
  const [manualIndex, setManualIndex] = useState<number | null>(null);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      const track = trackRef.current;
      if (!track) return;

      const rect = track.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      const stickyTop = 104;
      const stickyHeight = Math.max(1, viewport - stickyTop);
      const scrollable = Math.max(1, rect.height - stickyHeight);
      const raw = (stickyTop - rect.top) / scrollable;

      if (manualIndexRef.current !== null) {
        const hasUserScrolled = Math.abs(window.scrollY - manualScrollYRef.current) > 4;
        if (!hasUserScrolled) return;
        manualIndexRef.current = null;
        setManualIndex(null);
      }

      setProgress(clamp01(raw));
    };

    const requestUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  const displayProgress = manualIndex !== null ? manualIndex / productFlow.length : progress;
  const activeIndex =
    manualIndex ?? Math.min(productFlow.length - 1, Math.floor(progress * productFlow.length));

  const handleStageSelect = (index: number) => {
    manualIndexRef.current = index;
    manualScrollYRef.current = window.scrollY;
    setManualIndex(index);
    const targetProgress = index / productFlow.length;
    setProgress(targetProgress);
  };

  return (
    <section
      className="flow-section scroll-section"
      style={{ "--flow-progress": displayProgress } as CSSProperties}
    >
      <div className="section-heading" id="how" data-reveal>
        <h2>Prove. Score. Borrow.</h2>
      </div>
      <div className="flow-track" ref={trackRef}>
        <div className="flow-sticky">
          <div className="flow-layout" data-reveal>
            <div className="flow-list" aria-label="CredFlow borrowing steps">
              {productFlow.map((item, index) => {
                const itemProgress = clamp01(displayProgress * productFlow.length - index);
                const isActive = index === activeIndex;
                return (
                  <article
                    className={isActive ? "is-active" : undefined}
                    key={item.title}
                    onClick={() => handleStageSelect(index)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleStageSelect(index);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    style={{ "--item-progress": itemProgress } as CSSProperties}
                    aria-current={isActive ? "step" : undefined}
                    aria-label={`Show stage ${item.step}: ${item.title}`}
                  >
                    <div className="flow-card__top">
                      <span>{item.step}</span>
                      <b>{item.label}</b>
                    </div>
                    <div className="flow-card__body">
                      <div className="flow-card__copy">
                        <h3>{item.title}</h3>
                        <p>{item.copy}</p>
                        <small>{item.note}</small>
                      </div>
                      {isActive ? (
                        <figure className="flow-card__art" aria-hidden="true">
                          <Image src={item.image} alt="" width={500} height={500} />
                        </figure>
                      ) : null}
                    </div>
                    <i aria-hidden="true" />
                  </article>
                );
              })}
            </div>
            <FlowBentoStage activeIndex={activeIndex} progress={progress} />
          </div>
        </div>
      </div>
    </section>
  );
}

function ScoreTierLadder() {
  const tiers = [
    { name: "Starter", score: "580", ltv: "45%", state: "Baseline" },
    { name: "Reliable", score: "660", ltv: "65%", state: "Reduced" },
    { name: "Prime", score: "742", ltv: "85%", state: "Unlocked" },
  ];

  return (
    <div className="tier-ladder" aria-label="Score tier ladder preview">
      <div className="tier-ladder__header">
        <span>Score tier ladder</span>
        <strong>Prime</strong>
      </div>
      <div className="tier-ladder__body">
        <div className="tier-ladder__axis" aria-hidden="true">
          <span>More collateral</span>
          <i />
          <span>Less collateral</span>
        </div>
        <div className="tier-steps">
          {tiers.map((tier, index) => (
            <div className={index === 2 ? "tier-step is-active" : "tier-step"} key={tier.name}>
              <div>
                <span>{tier.name}</span>
                <strong>{tier.score}+</strong>
              </div>
              <i aria-hidden="true" />
              <small>{tier.ltv} LTV</small>
              <b>{tier.state}</b>
            </div>
          ))}
        </div>
        <div className="tier-summary">
          <div>
            <span>Collateral unlocked</span>
            <strong>Lower backing</strong>
          </div>
          <div>
            <span>Proof source</span>
            <strong>Wallet or bank</strong>
          </div>
          <div>
            <span>Monitoring</span>
            <strong>Always on</strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrustVisual() {
  return (
    <div className="trust-visual" aria-label="CredFlow trust layer preview">
      <div className="trust-receipt">
        <span>Decision receipt</span>
        <div><b>Positive</b><i /></div>
        <div><b>Clean history</b><i /></div>
        <div className="soft"><b>Thin proof</b><i /></div>
      </div>
      <div className="trust-agent">
        <span>Agent status</span>
        <strong>Loan watched</strong>
      </div>
    </div>
  );
}

export default function Home() {
  const [isHeaderScrolled, setIsHeaderScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const updateHeader = () => setIsHeaderScrolled(window.scrollY > 20);
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);

  useEffect(() => {
    document.body.style.overflowY = isMobileMenuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflowY = "";
    };
  }, [isMobileMenuOpen]);

  const closeMobileMenu = () => setIsMobileMenuOpen(false);

  return (
    <main>
      <Script src="https://unpkg.com/@lottiefiles/lottie-player@2.0.12/dist/lottie-player.js" strategy="afterInteractive" />
      <ClientEffects />
      <header
        className={`nav-command${isHeaderScrolled ? " is-scrolled" : ""}${
          isMobileMenuOpen ? " is-menu-open" : ""
        }`}
      >
        <div className="nav-shell">
        <a className="wordmark" href="#top" aria-label="CredFlow home">
          <Image src="/logo.png" alt="CredFlow" width={857} height={291} loading="eager" fetchPriority="high" />
        </a>
        <nav aria-label="Landing navigation">
          <a href="#why">Why</a>
          <a href="#how">How</a>
          <a href="#preview">Preview</a>
          <a href="#access">Access</a>
        </nav>
        <a className="nav-action" href="#access">Request access</a>
        <button
          className="nav-menu-toggle"
          type="button"
          aria-label="Toggle menu"
          aria-expanded={isMobileMenuOpen}
          onClick={() => setIsMobileMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>
        </div>
        <div className="mobile-menu" aria-hidden={!isMobileMenuOpen}>
          <div className="mobile-menu__links" aria-label="Mobile navigation">
            <a href="#why" onClick={closeMobileMenu}>Why</a>
            <a href="#how" onClick={closeMobileMenu}>How</a>
            <a href="#preview" onClick={closeMobileMenu}>Preview</a>
            <a href="#access" onClick={closeMobileMenu}>Access</a>
          </div>
          <div className="mobile-menu__actions">
            <a href="#access" onClick={closeMobileMenu}>Request access</a>
          </div>
        </div>
      </header>

      <section className="hero-command scroll-section" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Undercollateralized credit for proven borrowers</p>
          <h1>
            Borrow with less collateral using <HeroTypedWord />
          </h1>
          <p className="qualifier">
            CredFlow uses wallet history and bank-record proofs to build a credit score that can unlock better borrowing terms.
          </p>
          <div className="hero-actions">
            <a className="cta-primary" href="#access">Request access</a>
            <a className="cta-secondary" href="#why">See why</a>
          </div>
        </div>
        <HeroCreditNetwork />
      </section>

      <section className="value-section scroll-section" id="why">
        <div className="section-heading" data-reveal>
          <h2>Earn better terms.</h2>
        </div>
        <div className="value-grid">
          {valueProps.map((item) => (
            <article className="value-card" key={item.title} data-reveal>
              <div className="value-card__copy">
                <span>{item.label}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
              <figure className="value-card__art" aria-hidden="true">
                <Image src={item.image} alt="" width={577} height={433} />
              </figure>
            </article>
          ))}
        </div>
      </section>

      <FlowExperience />

      <section className="preview-section scroll-section" id="preview">
        <div className="section-copy" data-reveal>
          <h2>Score raises capacity.</h2>
          <p>
            CredFlow maps borrower trust into clear tiers, so stronger credit can unlock higher LTV and less upfront collateral.
          </p>
          <ul className="capacity-notes" aria-label="Score capacity highlights">
            <li>
              <span>01</span>
              <strong>Higher score, higher LTV</strong>
            </li>
            <li>
              <span>02</span>
              <strong>Wallet or bank proof</strong>
            </li>
            <li>
              <span>03</span>
              <strong>Terms stay monitored</strong>
            </li>
          </ul>
        </div>
        <ScoreTierLadder />
      </section>

      <section className="trust-section scroll-section" id="trust">
        <div className="section-heading" data-reveal>
          <h2>Proof without exposure.</h2>
        </div>
        <div className="trust-layout">
          <div className="trust-grid">
            {trustItems.map((item) => (
              <article className="trust-card" key={item.title} data-reveal>
                <span>{item.tag}</span>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </article>
            ))}
          </div>
          <TrustVisual />
        </div>
      </section>

      <section className="access scroll-section" id="access">
        <div data-reveal>
          <p>Borrow beyond collateral.</p>
          <span>Try CredFlow with a borrower profile built from wallet history or verified bank records.</span>
          <a className="try-now" href="#top">Try now</a>
        </div>
      </section>

      <footer className="site-footer">
        <div className="footer-brand">
          <a className="footer-logo" href="#top" aria-label="CredFlow home">
            <Image src="/logo.png" alt="CredFlow" width={857} height={291} />
          </a>
          <p>Credit-score driven borrowing for wallets and verified bank records.</p>
        </div>
        <div className="footer-links" aria-label="Footer navigation">
          <div>
            <span>Product</span>
            <a href="#why">Why CredFlow</a>
            <a href="#how">How it works</a>
            <a href="#preview">Borrowing preview</a>
          </div>
          <div>
            <span>Trust</span>
            <a href="#trust">Trust layer</a>
            <a href="#preview">Quote clarity</a>
            <a href="#access">Early access</a>
          </div>
          <div>
            <span>Access</span>
            <a href="#access">Request access</a>
            <a href="mailto:hello@credflow.xyz">Contact</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>CredFlow</span>
          <span>Built for the Arbitrum Open House Hackathon.</span>
        </div>
      </footer>
    </main>
  );
}
