"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { WalletButton } from "./WalletButton";
import { X_URL } from "@/lib/site";

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

interface NavLinkItem {
  href: string;
  label: string;
}

const NAV_LINKS: NavLinkItem[] = [
  { href: "/", label: "Home" },
  { href: "/fleet", label: "Fleet" },
  { href: "/machines", label: "Explorer" },
  { href: "/passport", label: "Passport" },
  { href: "/map", label: "Map" },
  { href: "/stake", label: "Stake" },
  { href: "/burn", label: "Burn" },
  { href: "/docs", label: "Docs" },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Monitor scroll depth for condensation & border glow
  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 16);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock scroll when mobile menu is open
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const isLinkActive = (item: NavLinkItem) => {
    if (item.href === "/") {
      return pathname === "/";
    }
    return pathname === item.href || pathname.startsWith(item.href + "/");
  };

  return (
    <>
      <header className={`nav ${scrolled ? "nav-scrolled" : ""}`}>
        {/* Brand Logo */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <Link href="/" className="logo" aria-label="PINELY Home">
            <Image
              src="/brand/pinely-logo-transparent.png"
              alt=""
              width={32}
              height={32}
              priority
              style={{ width: "32px", height: "32px", objectFit: "contain" }}
            />
            <span>PINELY</span>
          </Link>
        </div>

        {/* Desktop Centered Pill Menu */}
        <nav className="pill" id="menu" aria-label="Primary Navigation">
          {NAV_LINKS.map((item) => {
            const active = isLinkActive(item);
            return (
              <Link key={item.href} href={item.href} className={active ? "on" : ""}>
                {active && (
                  <motion.span
                    layoutId="navbar-pill-active"
                    className="pill-active-bg"
                    transition={{ type: "spring", stiffness: 420, damping: 32 }}
                  />
                )}
                <span style={{ position: "relative", zIndex: 1 }}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right Actions: Connect Wallet & Pilot CTA */}
        <div className="nav-actions">
          {/* Official X Profile Icon Button */}
          <a
            href={X_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="nav-icon-btn"
            aria-label="Official PINELY X Profile"
            title="Follow @pinely_protocol on X"
          >
            <XIcon width={16} height={16} />
          </a>

          <div className="hidden lg:block">
            <WalletButton />
          </div>

          <Link href="/pilot" className="btn red cta">
            Apply for pilot
          </Link>

          {/* Mobile Hamburger Toggle */}
          <button
            className="btn menu-btn"
            id="menuBtn"
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            aria-label="Toggle Navigation Menu"
            onClick={() => setMobileOpen((prev) => !prev)}
          >
            {mobileOpen ? "Close" : "Menu"}
          </button>
        </div>
      </header>

      {/* Mobile Drawer Navigation with Dark Backdrop */}
      {mobileOpen && (
        <>
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.82)",
              zIndex: 45,
            }}
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-menu"
            className="pill show"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile Navigation"
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px 14px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                marginBottom: "6px",
              }}
            >
              <span
                style={{ fontSize: "12px", fontFamily: "var(--font-sans)", color: "var(--mut)" }}
              >
                PINELY MENU
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                style={{
                  fontSize: "12px",
                  color: "var(--bl)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  background: "rgba(224, 72, 107, 0.1)",
                }}
              >
                Close ✕
              </button>
            </div>
            {NAV_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={isLinkActive(item) ? "on" : ""}
                onClick={() => setMobileOpen(false)}
                style={{
                  minHeight: "44px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {item.label}
              </Link>
            ))}
            <div style={{ padding: "12px 8px 6px", display: "grid", gap: "10px" }}>
              <Link
                href="/pilot"
                className="btn red"
                style={{ width: "100%", padding: "12px", minHeight: "44px" }}
                onClick={() => setMobileOpen(false)}
              >
                Apply for pilot
              </Link>
              <a
                href={X_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="btn dark"
                aria-label="Official PINELY X Profile"
                title="Follow @pinely_protocol on X"
                style={{
                  width: "100%",
                  minHeight: "44px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <XIcon width={16} height={16} />
              </a>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <WalletButton fullWidth />
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
