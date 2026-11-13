import Link from "next/link";
import { Navbar } from "@/components/pinely/Navbar";
import { Footer } from "@/components/pinely/Footer";
import { activeChain, stablecoinSymbol, blockTimeLabel } from "@/lib/chain";
import { Marquee } from "@/components/pinely/Marquee";
import { RobotHeroStage } from "@/components/pinely/hero/RobotHeroStage";
import { HeroSpatialBackdrop } from "@/components/pinely/hero/HeroSpatialBackdrop";
import { MetricLedgerStrip } from "@/components/pinely/MetricLedgerStrip";
import { ProblemContrast } from "@/components/pinely/ProblemContrast";
import { TechStackBlueprint } from "@/components/pinely/TechStackBlueprint";
import { TacticalCommandCockpit } from "@/components/pinely/TacticalCommandCockpit";
import { FieldScenarios } from "@/components/pinely/FieldScenarios";
import { FleetSavingsCalculator } from "@/components/pinely/FleetSavingsCalculator";
import { MissionTrajectory } from "@/components/pinely/MissionTrajectory";
import { DataBusConduit } from "@/components/pinely/DataBusConduit";
import { TextScramble } from "@/components/pinely/TextScramble";

export default function HomePage() {
  return (
    <div className="frame">
      {/* Silicon Data Bus Conduit Tracker */}
      <DataBusConduit />

      <Navbar />
      <main id="main-content">
        {/* Telemetry Status Bar */}
        <div className="status" role="status">
          <span className="item">
            <span className="pulse-beacon green" />
            <span>
              <b>{activeChain.name}</b> · Chain {activeChain.id}
            </span>
          </span>
          <span className="item text-zinc-300">
            <span>Block time {blockTimeLabel}</span>
            <span style={{ opacity: 0.4 }}>|</span>
            <span>Stage 1 Core</span>
          </span>
          <span className="item">
            <span style={{ color: "var(--bl)" }}>⚡ Gas Sponsored</span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>{stablecoinSymbol} Settlement</span>
          </span>
        </div>

        {/* Hero Section: Option A Cinematic Spatial Layering */}
        <section className="hero hero-spatial" id="home" data-spy>
          {/* Layer 3 Top: Technical Status Eyebrow */}
          <div className="hero-eyebrow-wrap">
            <span className="hero-eyebrow">
              <span className="pulse-beacon green" />
              <TextScramble
                text={`${activeChain.name.toUpperCase()} · ${blockTimeLabel.toUpperCase()} BLOCKS`}
                scrambleSpeed={20}
                revealSpeed={35}
              />
            </span>
          </div>

          {/* Spatial Stage Container: Layer 1 Backdrop + Layer 2 3D Robot Forefront */}
          <div className="hero-spatial-stage">
            {/* Layer 1: Monumental Backdrop Typography & Perspective Grid Floor with 3D Spatial Recede */}
            <HeroSpatialBackdrop />

            {/* Layer 2: 3D Robot Interactive Forefront Stage Overlapping the Headline */}
            <RobotHeroStage />
          </div>

          {/* Layer 3 Bottom: Ergonomic Narrative Controls & Direct CTAs */}
          <div className="hero-foreground-ui">
            <p className="hero-lead">
              Wallets for robots, drones, and autonomous hardware on Robinhood Chain. Machines earn
              and pay on their own, under session keys and a kill switch their operator controls.
            </p>

            <div className="hero-actions">
              <Link href="/pilot" className="btn red">
                Apply for Pilot Fleet →
              </Link>
              <a href="#problem" className="btn dark">
                Explore Network
              </a>
            </div>

            <div className="hero-telemetry-note">
              Session keys, kill switch, sponsored gas. Settled in {stablecoinSymbol}.
            </div>
          </div>
        </section>

        {/* Key Protocol Metric Ledger Strip */}
        <MetricLedgerStrip />

        {/* Logos Marquee Strip */}
        <Marquee />

        {/* CHAPTER 01: The Core Tension & Ledger Proof */}
        <ProblemContrast />

        {/* CHAPTER 02: Physical AI Tech Stack (Silicon-to-Chain Architecture Blueprint) */}
        <TechStackBlueprint />

        {/* CHAPTER 03: Tactical Fleet Command Cockpit (Live Sandbox + Protocol Firewall) */}
        <TacticalCommandCockpit />

        {/* CHAPTER 04: Field Scenarios (Bento Overhaul) */}
        <FieldScenarios />

        {/* CHAPTER 05: Economic Engine (Interactive Fleet Savings & Staking Calculator) */}
        <FleetSavingsCalculator />

        {/* CHAPTER 05: Mission Orbit & Aerospace Trajectory */}
        <MissionTrajectory />

        {/* Bottom CTA Banner */}
        <section className="foot" id="contact" style={{ marginTop: "var(--space-section)" }}>
          <h2>Put your machines to work.</h2>
          <p style={{ maxWidth: "540px", color: "#ecd8de" }}>
            We&apos;re onboarding our first fleets of delivery rovers, drones, and charging
            stations. Session keys, a sub-second kill switch, sponsored gas, and an engineering team
            that ships with you.
          </p>
          <div className="ctas" style={{ marginTop: "24px" }}>
            <Link href="/pilot" className="btn red">
              Apply for Pilot Fleet →
            </Link>
            <Link href="/docs" className="btn dark">
              Read Developer Docs
            </Link>
          </div>
        </section>

        {/* Global Footer */}
      </main>
      <Footer />
    </div>
  );
}
