"use client";

import { useState } from "react";
import Link from "next/link";
import type { PilotHardwareEnclave, PilotMachineType } from "@pinely/shared/types";
import { isApiError, submitPilotApplication } from "@/lib/api";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { PricingTable } from "@/components/pinely/PricingTable";
import { Footer } from "@/components/pinely/Footer";
import { TextScramble } from "@/components/pinely/TextScramble";
import { Select, type SelectOption } from "@/components/pinely/Select";
import { activeChain, stablecoinSymbol, nativeSymbol } from "@/lib/chain";

const MACHINE_TYPE_OPTIONS: readonly SelectOption<PilotMachineType>[] = [
  { value: "Autonomous Delivery Rover", label: "Autonomous Delivery Rover" },
  { value: "Drone / Aerial Fleet", label: "Drone / Aerial Fleet" },
  { value: "Commercial EV Station", label: "Commercial EV Fast-Charger" },
  { value: "Warehouse AMR / AGV", label: "Warehouse AMR / AGV" },
  { value: "Smart Infrastructure / Locker", label: "Smart Infrastructure / Locker" },
  { value: "Other Physical AI", label: "Other Physical AI" },
];

const SECURITY_CHIP_OPTIONS: readonly SelectOption<PilotHardwareEnclave>[] = [
  { value: "NXP SE050 TPM", label: "NXP SE050 TPM (EAL6+)" },
  { value: "STSAFE-A110", label: "STSAFE-A110 (EAL5+)" },
  { value: "Microchip ATECC608", label: "Microchip ATECC608" },
  { value: "Infineon OPTIGA TPM", label: "Infineon OPTIGA TPM 2.0" },
  { value: "Software Keystore / Testing", label: "Software Keystore / Evaluating" },
];

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <span id={id} className="field-error" role="alert">
      {message}
    </span>
  );
}

type PilotField = "name" | "company" | "email" | "fleetSize";
type PilotErrors = Partial<Record<PilotField, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Our own validation: the browser's built-in bubbles are not part of the site's look. */
function validatePilotForm(data: {
  name: string;
  company: string;
  email: string;
  fleetSize: number;
}): PilotErrors {
  const errors: PilotErrors = {};
  if (!data.name.trim()) errors.name = "Enter your name.";
  if (!data.company.trim()) errors.company = "Enter your company or organization.";
  if (!EMAIL_PATTERN.test(data.email.trim())) errors.email = "Enter a valid work email address.";
  if (!Number.isInteger(data.fleetSize) || data.fleetSize < 1) {
    errors.fleetSize = "Enter a fleet size of 1 or more.";
  }
  return errors;
}

export default function PilotPage() {
  const [formData, setFormData] = useState({
    name: "",
    company: "",
    email: "",
    machineType: "Autonomous Delivery Rover" as PilotMachineType,
    fleetSize: 10,
    hardwareEnclave: "NXP SE050 TPM" as PilotHardwareEnclave,
    notes: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<PilotErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [appId, setAppId] = useState("");

  const quickFleetSizes = [10, 25, 50, 100, 250, 500];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validatePilotForm(formData);
    setErrors(found);
    const firstInvalid = (Object.keys(found) as PilotField[])[0];
    if (firstInvalid) {
      document.getElementById(`pilot-${firstInvalid}`)?.focus();
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // The reference is issued by the backend after the application is stored; it is never invented here.
      const result = await submitPilotApplication({
        operatorName: formData.name,
        organization: formData.company,
        email: formData.email,
        machineType: formData.machineType,
        deviceCount: Number(formData.fleetSize),
        hardwareEnclave: formData.hardwareEnclave,
        notes: formData.notes,
      });
      setAppId(`PLT-${String(result.data.id).padStart(5, "0")}`);
      setSubmitted(true);
    } catch (error) {
      setSubmitError(
        isApiError(error) && error.status >= 400 && error.status < 500
          ? error.message
          : "We could not send your application. Please try again in a moment.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="frame">
      <PageBackground word="PILOT" variant="desk" />
      <Navbar />
      <main id="main-content">
        {/* Header */}
        <section className="ph ph-haze ph-haze-pilot page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="FOUNDING FLEETS · PILOT ONBOARDING"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <h1>Light up your first fleet.</h1>
          <p>
            Deploying delivery rovers, drones, smart lockers, or EV chargers? Deploy as a founding
            fleet on Robinhood Chain with sponsored native gas, a one-transaction kill switch, and
            direct engineering support.
          </p>
        </section>

        {/* Section 01 Hairline */}
        <div className="section-hairline-label" style={{ marginTop: "40px" }}>
          <span>SECTION 01 · FOUNDING FLEET INCENTIVES & ARCHITECTURE</span>
        </div>

        {/* 3 Founding Pilot Benefits Cards */}
        <section className="sec page-reveal-1" style={{ paddingTop: "18px" }}>
          <div className="grid">
            <div className="card">
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <h2>Sponsored native gas</h2>
                <span className="tier-pill gold">Zero Custody</span>
              </div>
              <p className="note" style={{ marginTop: "8px", lineHeight: 1.5 }}>
                Physical devices never hold volatile native {nativeSymbol} on the street.
                PinelyPaymaster sponsors all transaction gas upfront and settles quota cleanly in{" "}
                {stablecoinSymbol}.
              </p>
            </div>

            <div className="card">
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <h2>Hardware-backed keys</h2>
                <span className="tier-pill silver">Planned</span>
              </div>
              <p className="note" style={{ marginTop: "8px", lineHeight: 1.5 }}>
                We are building support for NXP SE050, TPM 2.0 and secure microcontrollers so a
                machine key can stay in the chip. Pilot machines start with software session keys
                under an operator-controlled kill switch. Per-swap and daily caps arrive with Stage
                2.
              </p>
            </div>

            <div className="card hl">
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <h2>Operator Control Desk</h2>
                <span className="status-badge active">Fleet Pro</span>
              </div>
              <p style={{ marginTop: "8px", lineHeight: 1.5, fontSize: "14px", color: "#f0dde2" }}>
                Full access to Fleet Pro tools: spend policy setup (enforced by the Stage 2 hook),
                1-Tx emergency freeze, and automated revenue sweeps directly to your Safe multisig
                vault.
              </p>
            </div>
          </div>

          {/* Section 02 Hairline */}
          <div className="section-hairline-label" style={{ marginTop: "64px" }}>
            <span>SECTION 02 · ONCHAIN PROTOCOL PRICING PARAMETERS</span>
          </div>

          <PricingTable />

          {/* Section 03 Hairline */}
          <div className="section-hairline-label" style={{ marginTop: "64px" }}>
            <span>SECTION 03 · FOUNDING FLEET APPLICATION & QUOTA COCKPIT</span>
          </div>

          {/* Pilot Application Form / Success State (Full Width) */}
          <div style={{ marginTop: "18px", width: "100%" }}>
            {submitted ? (
              <div className="pilot-form-container">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "10px",
                  }}
                >
                  <span className="tier-pill gold font-mono">Application Reference: {appId}</span>
                  <span className="status-badge active font-mono">
                    <span className="pulse-beacon green" /> Received · Priority Queue
                  </span>
                </div>

                <div>
                  <h2
                    style={{
                      fontSize: "30px",
                      fontWeight: 700,
                      color: "#ffffff",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Application Received, {formData.name}.
                  </h2>
                  <p
                    style={{
                      color: "#d8c8cc",
                      fontSize: "15px",
                      lineHeight: 1.6,
                      marginTop: "8px",
                    }}
                  >
                    Our core engineering team will reach out to <strong>{formData.email}</strong>{" "}
                    within 24 hours with {activeChain.name} ({activeChain.id}) onboarding
                    credentials, starter gas sponsorship, and direct Slack / Telegram channel setup.
                  </p>
                </div>

                <div className="dossier-spec-list" style={{ margin: "10px 0" }}>
                  <div className="dossier-spec-row">
                    <span className="dossier-spec-label">ORGANIZATION</span>
                    <span
                      className="dossier-spec-val"
                      style={{ color: "#ffffff", fontWeight: 600 }}
                    >
                      {formData.company}
                    </span>
                  </div>
                  <div className="dossier-spec-row">
                    <span className="dossier-spec-label">FLEET PROFILE</span>
                    <span className="dossier-spec-val font-mono">
                      {formData.fleetSize} × {formData.machineType}
                    </span>
                  </div>
                  <div className="dossier-spec-row">
                    <span className="dossier-spec-label">SECURITY ENCLAVE</span>
                    <span className="dossier-spec-val font-mono">{formData.hardwareEnclave}</span>
                  </div>
                  <div className="dossier-spec-row">
                    <span className="dossier-spec-label">EXECUTION NETWORK</span>
                    <span className="dossier-spec-val font-mono">
                      {activeChain.name} ({activeChain.id})
                    </span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginTop: "12px" }}>
                  <Link href="/docs" className="btn red" style={{ fontSize: "13px" }}>
                    Read Developer Documentation →
                  </Link>
                  <button
                    type="button"
                    className="btn dark"
                    onClick={() => {
                      setSubmitted(false);
                      setFormData({
                        name: "",
                        company: "",
                        email: "",
                        machineType: "Autonomous Delivery Rover",
                        fleetSize: 10,
                        hardwareEnclave: "NXP SE050 TPM",
                        notes: "",
                      });
                    }}
                    style={{ fontSize: "13px" }}
                  >
                    Submit Another Fleet
                  </button>
                </div>
              </div>
            ) : (
              <div className="pilot-form-container">
                <div className="pilot-cockpit-grid">
                  {/* Left Column: Strategic Briefing & Real-Time Live Quota */}
                  <div className="pilot-dossier-panel">
                    <div>
                      <span className="text-xs uppercase tracking-wider text-crimson-400 font-mono">
                        FOUNDING FLEET REGISTRATION · STAGE 1 ON ROBINHOOD CHAIN
                      </span>
                      <h2
                        style={{
                          fontSize: "24px",
                          fontWeight: 700,
                          color: "#ffffff",
                          marginTop: "6px",
                          letterSpacing: "-0.01em",
                        }}
                      >
                        Apply for Founding Fleet Pilot
                      </h2>
                      <p className="note" style={{ marginTop: "6px", lineHeight: 1.5 }}>
                        Complete the registration questionnaire below. Our core team provisions
                        custom testnet Paymaster gas sponsorship, developer keys, and private
                        engineering channels within 24 hours.
                      </p>
                    </div>

                    {/* SLA Privileges Card */}
                    <div className="pilot-sla-card">
                      <div className="pilot-sla-item">
                        <div className="pilot-sla-icon font-mono">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--bl)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <polyline points="12 6 12 12 16 14" />
                          </svg>
                        </div>
                        <div className="pilot-sla-content">
                          <span className="pilot-sla-title">24-Hour Provisioning SLA</span>
                          <span className="pilot-sla-desc">
                            Guaranteed credentials and testnet Paymaster deployment within 24 hours
                            of submission.
                          </span>
                        </div>
                      </div>

                      <div className="pilot-sla-item">
                        <div className="pilot-sla-icon font-mono">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--bl)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M3 22h12" />
                            <path d="M4 9h10" />
                            <path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18" />
                            <path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5" />
                          </svg>
                        </div>
                        <div className="pilot-sla-content">
                          <span className="pilot-sla-title">100% Native Gas Covered</span>
                          <span className="pilot-sla-desc">
                            Automated {nativeSymbol} sponsorship via PinelyPaymaster; settled
                            cleanly in
                            {stablecoinSymbol}.
                          </span>
                        </div>
                      </div>

                      <div className="pilot-sla-item">
                        <div className="pilot-sla-icon font-mono">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--bl)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <rect x="4" y="4" width="16" height="16" rx="2" />
                            <rect x="9" y="9" width="6" height="6" />
                            <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
                          </svg>
                        </div>
                        <div className="pilot-sla-content">
                          <span className="pilot-sla-title">Non-Exportable Key Bridge</span>
                          <span className="pilot-sla-desc">
                            Direct integration support for TPM 2.0 / NXP SE050 hardware security
                            modules.
                          </span>
                        </div>
                      </div>

                      <div className="pilot-sla-item">
                        <div className="pilot-sla-icon font-mono">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="var(--bl)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="4 17 10 11 4 5" />
                            <line x1="12" y1="19" x2="20" y2="19" />
                          </svg>
                        </div>
                        <div className="pilot-sla-content">
                          <span className="pilot-sla-title">Direct Core Dev Relay</span>
                          <span className="pilot-sla-desc">
                            Private Telegram / Slack engineering bridge directly with PINELY core
                            protocol authors.
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Live Capacity Estimator Box */}
                    <div className="pilot-live-quota-box font-mono">
                      <div className="pilot-live-quota-header">
                        <span>LIVE QUOTA PREVIEW</span>
                        <span className="tier-pill gold" style={{ fontSize: "10px" }}>
                          {formData.fleetSize} NODES
                        </span>
                      </div>

                      <div className="dossier-spec-list" style={{ margin: 0 }}>
                        <div className="dossier-spec-row">
                          <span className="dossier-spec-label">EXECUTION NETWORK</span>
                          <span className="dossier-spec-val">
                            {activeChain.name} ({activeChain.id})
                          </span>
                        </div>
                        <div className="dossier-spec-row">
                          <span className="dossier-spec-label">SETTLEMENT ASSET</span>
                          <span className="dossier-spec-val">{stablecoinSymbol} (6 Decimals)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Application Form */}
                  <form
                    noValidate
                    className="form"
                    id="pilotForm"
                    onSubmit={handleSubmit}
                    style={{
                      maxWidth: "100%",
                      display: "flex",
                      flexDirection: "column",
                      gap: "20px",
                    }}
                  >
                    {/* Dual Column: Name & Company */}
                    <div className="pilot-form-grid-2">
                      <label>
                        Lead Engineer / Operator Name
                        <input
                          id="pilot-name"
                          type="text"
                          placeholder="Ada Lovelace"
                          value={formData.name}
                          aria-invalid={errors.name ? true : undefined}
                          aria-describedby={errors.name ? "pilot-name-error" : undefined}
                          onChange={(e) => {
                            setFormData({ ...formData, name: e.target.value });
                            setErrors((prev) => ({ ...prev, name: undefined }));
                          }}
                        />
                        <FieldError id="pilot-name-error" message={errors.name} />
                      </label>

                      <label>
                        Robotics Company / Organization
                        <input
                          id="pilot-company"
                          type="text"
                          placeholder="Autonomous Fleet Robotics Inc."
                          value={formData.company}
                          aria-invalid={errors.company ? true : undefined}
                          aria-describedby={errors.company ? "pilot-company-error" : undefined}
                          onChange={(e) => {
                            setFormData({ ...formData, company: e.target.value });
                            setErrors((prev) => ({ ...prev, company: undefined }));
                          }}
                        />
                        <FieldError id="pilot-company-error" message={errors.company} />
                      </label>
                    </div>

                    {/* Full Width: Work Email */}
                    <label>
                      Work Email (Direct Engineering Contact)
                      <input
                        id="pilot-email"
                        type="email"
                        placeholder="ada@robotics.io"
                        value={formData.email}
                        aria-invalid={errors.email ? true : undefined}
                        aria-describedby={errors.email ? "pilot-email-error" : undefined}
                        onChange={(e) => {
                          setFormData({ ...formData, email: e.target.value });
                          setErrors((prev) => ({ ...prev, email: undefined }));
                        }}
                      />
                      <FieldError id="pilot-email-error" message={errors.email} />
                    </label>

                    {/* Dual Column: Machine Type & Security Chip */}
                    <div className="pilot-form-grid-2">
                      <label>
                        Physical AI Machine Type
                        <Select
                          value={formData.machineType}
                          onChange={(machineType) => setFormData({ ...formData, machineType })}
                          options={MACHINE_TYPE_OPTIONS}
                          ariaLabel="Physical AI machine type"
                        />
                      </label>

                      <label>
                        Security chip on your machines
                        <Select
                          value={formData.hardwareEnclave}
                          onChange={(hardwareEnclave) =>
                            setFormData({ ...formData, hardwareEnclave })
                          }
                          options={SECURITY_CHIP_OPTIONS}
                          ariaLabel="Security chip on your machines"
                        />
                      </label>
                    </div>

                    {/* Fleet Size with Quick Select Chips */}
                    <div>
                      <label>
                        Planned Pilot Fleet Size (Number of Units)
                        <input
                          id="pilot-fleetSize"
                          type="number"
                          min="1"
                          aria-invalid={errors.fleetSize ? true : undefined}
                          aria-describedby={errors.fleetSize ? "pilot-fleetSize-error" : undefined}
                          value={formData.fleetSize}
                          onChange={(e) => {
                            setFormData({
                              ...formData,
                              fleetSize: Math.max(1, parseInt(e.target.value, 10) || 1),
                            });
                            setErrors((prev) => ({ ...prev, fleetSize: undefined }));
                          }}
                          className="font-mono"
                        />
                        <FieldError id="pilot-fleetSize-error" message={errors.fleetSize} />
                      </label>
                      <div className="quick-chip-group font-mono">
                        {quickFleetSizes.map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => setFormData({ ...formData, fleetSize: size })}
                            className={`quick-chip-btn ${formData.fleetSize === size ? "active" : ""}`}
                          >
                            {size} Units
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Operational Notes */}
                    <label>
                      Operational Deployment Notes & Requirements (Optional)
                      <textarea
                        rows={4}
                        placeholder="Describe your current charging/settlement workflow, ROS2 integration needs, or planned deployment timeline..."
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      />
                    </label>

                    {submitError && (
                      <p
                        role="alert"
                        style={{ color: "#ff8fa3", fontSize: "13px", marginTop: "4px" }}
                      >
                        {submitError}
                      </p>
                    )}

                    <button
                      className="btn red"
                      type="submit"
                      disabled={isSubmitting}
                      style={{
                        marginTop: "8px",
                        width: "100%",
                        minHeight: "48px",
                        fontSize: "14px",
                        fontWeight: 700,
                      }}
                    >
                      {isSubmitting
                        ? "Submitting Application..."
                        : "Submit Founding Fleet Application →"}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
