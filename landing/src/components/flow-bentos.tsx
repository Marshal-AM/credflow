import type { CSSProperties } from "react";

type FlowBentoProps = {
  progress: number;
};

const WalletIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>;
const BankIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="6" rx="2"/><path d="M2 10h20"/><path d="M6 14h.01"/><path d="M10 14h.01"/></svg>;
const CheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>;
const ShieldCheckIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2-1 4-2 6-3.89a1 1 0 0 1 1.18 0C13 3 15 4 17 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/></svg>;
const LockIcon = () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>;

function SignalIntakeBento() {
  return (
    <div className="flow-bento flow-bento--source" aria-label="CredFlow signal intake preview">
      <div className="bento-panel ui-panel ui-panel--source-primary !justify-start">
        <div className="flex items-center justify-between pb-2 border-b border-border/10 mb-5">
          <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">Profile Sources</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 shadow-[0_0_10px_color-mix(in_oklch,var(--color-primary),transparent_90%)]">2 Connected</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col bg-zinc-900/40 rounded-xl border border-border/20 p-4 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <WalletIcon />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">Wallet</span>
                <span className="text-xs text-muted-foreground font-mono">0x71...9b2</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-primary font-medium bg-primary/10 px-2.5 py-1 rounded w-fit border border-primary/20">
              <CheckIcon /> Borrow history synced
            </div>
          </div>

          <div className="flex flex-col bg-zinc-900/40 rounded-xl border border-border/20 p-4 relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="flex items-center gap-3 mb-5">
              <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20 text-primary">
                <BankIcon />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-foreground">Bank records</span>
                <span className="text-xs text-muted-foreground">zkTLS attestation</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-primary font-medium bg-primary/10 px-2.5 py-1 rounded w-fit border border-primary/20">
              <ShieldCheckIcon /> Proof verified
            </div>
          </div>
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--source-side !justify-start">
        <div className="flex items-center justify-between pb-2 border-b border-border/10 mb-4">
          <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">Signals Extracted</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-400">Ready</span>
        </div>
        <div className="flex flex-col gap-3.5 mt-2">
          {[
            { label: "Repayment logic", val: "High" },
            { label: "Wallet age", val: "2.4 yrs" },
            { label: "Liquidity tier", val: "$10k+" },
            { label: "Proof validity", val: "Valid" }
          ].map((s, i) => (
            <div key={i} className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-colors" />
                <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">{s.label}</span>
              </div>
              <span className="text-xs font-mono text-zinc-300">{s.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--source-footer !justify-end relative">
        <div className="flex items-center justify-between bg-zinc-900/40 rounded-lg p-3.5 border border-border/10">
          <div className="flex items-center gap-3">
            <div className="w-2 h-8 bg-primary/90 rounded block shadow-[0_0_8px_color-mix(in_oklch,var(--color-primary),transparent_60%)]" aria-hidden="true" />
            <div className="flex flex-col">
              <strong className="text-sm font-medium text-foreground">Credit file generated</strong>
              <span className="text-xs text-muted-foreground">All inputs cryptographically signed</span>
            </div>
          </div>
          <div className="text-xs font-mono text-zinc-500 flex items-center gap-2">
            Proceeding to scoring <span className="animate-pulse">_</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreBuildBento({ progress }: FlowBentoProps) {
  return (
    <div
      className="flow-bento flow-bento--score-build"
      style={{ "--scene-progress": progress } as CSSProperties}
      aria-label="CredFlow scoring preview"
    >
      <div className="bento-panel ui-panel ui-panel--score-main flex flex-col items-center justify-start pt-10 relative overflow-hidden group">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,var(--color-primary)_0%,transparent_60%)] opacity-[0.03]" />
        <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70 mb-8">CredScore</span>
        <div className="relative flex items-center justify-center mb-6 py-4 px-12">
          {/* animated ring effect - properly sized ellipses! */}
          <div className="absolute inset-0 rounded-[100%] border-[1.5px] border-primary/20 scale-[1.0] opacity-50" />
          <div className="absolute inset-0 rounded-[100%] border border-primary/40 scale-[1.12] opacity-20" />
          <strong className="text-6xl md:text-7xl font-light tracking-tighter text-foreground bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/70 relative z-10 leading-none">742</strong>
        </div>
        <div className="flex items-center gap-2 mt-2 bg-primary/10 border border-primary/20 px-3.5 py-1.5 rounded-full relative z-10">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-primary font-medium uppercase tracking-widest">Prime Borrower Tier</span>
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--score-factors !justify-start">
        <div className="flex items-center justify-between pb-2 border-b border-border/10 mb-5">
          <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">Factor Weights (SHAP)</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-primary">Live</span>
        </div>
        <div className="flex flex-col gap-4">
          {[
            { label: "Repayment history", pct: 92, val: "+84" },
            { label: "Wallet maturity", pct: 72, val: "+42" },
            { label: "Proof-of-reserves", pct: 58, val: "+31" },
            { label: "Sybil risk offset", pct: 34, val: "-12", neg: true }
          ].map((f, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-foreground/80">{f.label}</span>
                <span className={`font-mono ${f.neg ? 'text-primary/70' : 'text-primary'}`}>{f.val}</span>
              </div>
              <div className="h-1.5 w-full bg-zinc-800/60 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full ${f.neg ? 'bg-primary/50' : 'bg-primary shadow-[0_0_8px_var(--color-primary)]'}`}
                  style={{ width: `${f.pct}%` }} 
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--score-table !justify-end pt-0">
        <div className="flex items-center justify-between pb-2 border-b border-border/10 mb-4">
          <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">Risk Constraints</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-primary">Passed</span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { l: "Liquidations", v: "None" },
            { l: "Graph Path", v: "Clean" },
            { l: "Debt Ratio", v: "Optimal" }
          ].map((k, i) => (
            <div key={i} className="flex flex-col justify-center items-center bg-zinc-900/40 rounded-lg py-3 px-2 border border-border/10">
              <span className="text-[10px] text-muted-foreground mb-1.5">{k.l}</span>
              <span className="text-xs font-semibold text-zinc-200">{k.v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function QuoteUnlockBento() {
  return (
    <div className="flow-bento flow-bento--quote-unlock" aria-label="CredFlow borrow quote preview">
      <div className="bento-panel ui-panel ui-panel--quote-main flex flex-col justify-start pt-10">
        <div className="flex flex-col items-center mb-10 relative">
          <div className="absolute -top-4 w-full h-32 bg-primary/5 blur-[40px] rounded-full" />
          <span className="text-[10px] uppercase font-mono tracking-widest text-primary mb-3 flex items-center gap-1.5"><LockIcon /> <span>Quote Unlocked</span></span>
          <span className="text-sm text-muted-foreground mt-2">Available Capacity</span>
          <strong className="text-5xl md:text-6xl font-light text-foreground mt-2 tracking-tight leading-none">$3,000 <span className="text-2xl text-muted-foreground ml-1">USDC</span></strong>
        </div>
        
        <div className="grid grid-cols-3 gap-0 border-y border-border/10 py-5 mx-6">
          <div className="flex flex-col items-center border-r border-border/10">
            <span className="text-2xl font-light text-zinc-200">85%</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-2">Max LTV</span>
          </div>
          <div className="flex flex-col items-center border-r border-border/10">
            <span className="text-2xl font-light text-zinc-200">30d</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-2">Term</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-2xl font-light text-primary">742</span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-2">Score</span>
          </div>
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--quote-side !justify-start">
        <div className="flex items-center justify-between pb-2 border-b border-border/10 mb-5">
          <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">Collateral Required</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">-45% Reduced</span>
        </div>
        <div className="flex flex-col gap-6 mt-2 relative">
          <div className="absolute inset-x-0 bottom-1 top-3 border-l-[1.5px] border-dashed border-border/20 left-[15px] z-0" />
          
          <div className="relative z-10 flex flex-col gap-2">
            <div className="text-xs text-muted-foreground flex justify-between"><span>DeFi Standard</span> <span className="font-mono">$3,800</span></div>
            <div className="h-4 w-full bg-zinc-800/80 rounded overflow-hidden">
               <div className="h-full bg-zinc-600 w-[95%]" />
            </div>
          </div>
          <div className="relative z-10 flex flex-col gap-2">
            <div className="text-xs text-foreground flex justify-between font-medium"><span>CredFlow</span> <span className="font-mono text-primary">$2,100</span></div>
            <div className="h-4 w-full bg-zinc-800/60 rounded overflow-hidden relative">
               <div className="absolute inset-0 bg-primary/20 w-[55%]" />
               <div className="h-full bg-primary w-[55%] shadow-[0_0_12px_color-mix(in_oklch,var(--color-primary),transparent_50%)] border-r border-primary/40" />
            </div>
          </div>
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--quote-action !justify-end relative">
         <div className="flex items-center justify-between bg-primary/10 border border-primary/20 rounded-xl p-4 group cursor-pointer hover:bg-primary/15 transition-colors">
            <div className="flex flex-col gap-1">
              <strong className="text-base font-medium text-foreground">Accept 85% LTV Terms</strong>
              <span className="text-xs text-primary/80">Smart contract ready to execute</span>
            </div>
            <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-[0_0_15px_var(--color-primary)] group-hover:scale-105 transition-transform">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </div>
         </div>
      </div>
    </div>
  );
}

function MonitoringBento() {
  return (
    <div className="flow-bento flow-bento--monitoring" aria-label="CredFlow monitoring preview">
      <div className="bento-panel ui-panel ui-panel--monitor-main flex flex-col justify-start pt-8 relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-40 h-40 bg-primary/10 blur-[50px] rounded-full" />
        <div className="flex justify-between items-start mb-8">
          <span className="text-sm font-medium text-foreground">Health Buffer</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20 flex items-center gap-1.5"><div className="w-1.5 h-1.5 bg-primary animate-pulse rounded-full"/> Stable</span>
        </div>
        <div className="flex items-end gap-1.5 text-foreground font-light mb-8">
          <span className="text-6xl tracking-tighter leading-none">68</span><span className="text-3xl pb-1">%</span>
        </div>
        
        {/* visual chart replacement */}
        <div className="h-16 w-full flex items-end gap-1 opacity-80 mt-auto">
          {[40,45,42,48,55,60,65,62,68,68,68].map((h, i) => (
            <div key={i} className="flex-1 bg-gradient-to-t from-primary/50 to-primary/10 rounded-t-sm" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--monitor-feed !justify-start">
        <div className="flex items-center justify-between pb-2 border-b border-border/10 mb-5">
          <span className="text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">Agent Activity</span>
          <span className="text-[10px] uppercase font-mono tracking-wider text-zinc-500">Live</span>
        </div>
        <div className="flex flex-col gap-4.5 mt-2">
          {[
            { icon: <ShieldCheckIcon />, msg: "Score healthy", time: "now", color: "text-primary" },
            { icon: <BankIcon />, msg: "Loan state synced", time: "2m", color: "text-primary/70" },
            { icon: <CheckIcon />, msg: "Repayment window clear", time: "9m", color: "text-zinc-500" }
          ].map((a, i) => (
            <div key={i} className="flex items-center gap-3.5">
              <div className={`w-7 h-7 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center ${a.color} [&>svg]:w-3.5 [&>svg]:h-3.5`}>
                {a.icon}
              </div>
              <span className={`text-xs flex-1 ${i === 0 ? 'text-zinc-200' : 'text-zinc-400'}`}>{a.msg}</span>
              <span className="text-[10px] font-mono text-zinc-600">{a.time}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bento-panel ui-panel ui-panel--monitor-sync !justify-end">
        <div className="flex items-center justify-between w-full bg-zinc-900/40 rounded-xl p-4 border border-border/10">
          <div className="flex flex-col w-full">
            <div className="flex items-center justify-between mb-4 text-[10px] uppercase font-mono tracking-widest text-muted-foreground/70">
              Credit Memory State
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-[9px] text-primary font-bold">B</div>
                <span className="text-xs text-zinc-200">Base</span>
              </div>
              <div className="h-px flex-1 mx-5 bg-gradient-to-r from-border/10 via-primary/50 to-border/10 relative">
                 <div className="absolute w-2 h-2 bg-primary rounded-full top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 shadow-[0_0_8px_var(--color-primary)]" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-200">Arbitrum</span>
                <div className="w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-[9px] text-primary/80 font-bold">A</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlowBentoStage({ activeIndex, progress }: FlowBentoProps & { activeIndex: number }) {
  if (activeIndex === 0) return <SignalIntakeBento />;
  if (activeIndex === 1) return <ScoreBuildBento progress={progress} />;
  if (activeIndex === 2) return <QuoteUnlockBento />;
  return <MonitoringBento />;
}
