import Link from "next/link";
import { Navbar } from "@/components/pinely/Navbar";
import { Footer } from "@/components/pinely/Footer";
import { isPublicChainId } from "@pinely/shared/chains";
import { activeChain, chainProfile, stablecoinSymbol } from "@/lib/chain";
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
import { TokenCa } from "@/components/pinely/TokenCa";

/** A non-mainnet build says so in the hero, so nobody mistakes it for production. */
const isTestnet = !isPublicChainId(activeChain.id);

export default function HomePage() {
  return (
    <div className="frame">
      {/* Silicon Data Bus Conduit Tracker */}
      <DataBusConduit />

      <Navbar />
      <main id="main-content">
        {/* Hero Section: Option A Cinematic Spatial Layering */}
        <section className="hero hero-spatial" id="home" data-spy>
          {/* Layer 3 Top: the one network line of the page. Chain id, block time and contract
              addresses live in the footer and the docs, not above the fold. */}
          <div className="hero-eyebrow-wrap">
            <span className={`hero-eyebrow${isTestnet ? " hero-eyebrow-testnet" : ""}`}>
              <span className="hero-eyebrow-name">{chainProfile.shortName}</span>{" "}
              <span className="hero-eyebrow-sep" aria-hidden="true" />{" "}
              <span>{stablecoinSymbol} settlement</span>
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

            <TokenCa variant="hero" />
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
