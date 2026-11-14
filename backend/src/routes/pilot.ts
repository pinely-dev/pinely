import { Hono } from "hono";
import { getAddress, isAddress } from "viem";
import { bodyLimit } from "hono/body-limit";
import {
  PILOT_HARDWARE_ENCLAVES,
  PILOT_LIMITS,
  PILOT_MACHINE_TYPES,
  type PilotApplicationResponse,
} from "@pinely/shared/types";
import { APP_SCHEMA, pool } from "../db/connection";
import { clientKey, createRateLimiter } from "../lib/rate-limit";

const pilotRoute = new Hono();

const MACHINE_TYPES: ReadonlySet<string> = new Set(PILOT_MACHINE_TYPES);
const HARDWARE_ENCLAVES: ReadonlySet<string> = new Set(PILOT_HARDWARE_ENCLAVES);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Public endpoint without authentication: bound request size and submission rate per caller. */
export const pilotRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.PILOT_RATE_LIMIT_PER_HOUR ?? 5),
});

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * An optional wallet or Safe address. Empty is allowed. Anything else must be a real address (the zero
 * address is not one) and is stored in checksum form. Returns `undefined` when it is not valid.
 */
function optionalAddress(value: string): string | null | undefined {
  if (!value) return null;
  if (!isAddress(value, { strict: false }) || /^0x0{40}$/.test(value)) return undefined;
  return getAddress(value);
}

/**
 * POST /api/pilot/applications
 * Accepts a real fleet pilot application and stores it in PostgreSQL so the team can follow up.
 * The returned `id` is the only valid application reference; the client must not invent one.
 */
pilotRoute.post(
  "/applications",
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) => c.json({ error: "Request body too large" }, 413),
  }),
  async (c) => {
    if (!pilotRateLimiter.allow(clientKey(c))) {
      return c.json({ error: "Too many applications. Try again later." }, 429);
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await c.req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return c.json({ error: "Invalid request body" }, 400);
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const operatorName = text(body.operatorName);
    const organization = text(body.organization);
    const machineType = text(body.machineType);
    const hardwareEnclave = text(body.hardwareEnclave);
    const notes = text(body.notes);
    const operatorAddress = optionalAddress(text(body.operatorAddress));
    const safeAddress = optionalAddress(text(body.safeAddress));
    const email = text(body.email).toLowerCase();
    const deviceCount = body.deviceCount;

    if (!operatorName) {
      return c.json({ error: "Operator name is required" }, 400);
    }
    if (
      operatorName.length > PILOT_LIMITS.operatorName ||
      organization.length > PILOT_LIMITS.organization ||
      notes.length > PILOT_LIMITS.notes
    ) {
      return c.json({ error: "A field exceeds its maximum length" }, 400);
    }
    if (!MACHINE_TYPES.has(machineType)) {
      return c.json({ error: "Unknown machine type" }, 400);
    }
    if (hardwareEnclave && !HARDWARE_ENCLAVES.has(hardwareEnclave)) {
      return c.json({ error: "Unknown hardware enclave" }, 400);
    }
    if (
      typeof deviceCount !== "number" ||
      !Number.isInteger(deviceCount) ||
      deviceCount < 1 ||
      deviceCount > PILOT_LIMITS.maxDevices
    ) {
      return c.json(
        { error: `Device count must be a whole number from 1 to ${PILOT_LIMITS.maxDevices}` },
        400,
      );
    }
    if (email.length > PILOT_LIMITS.email || !EMAIL_PATTERN.test(email)) {
      return c.json({ error: "Invalid contact email" }, 400);
    }
    if (operatorAddress === undefined) {
      return c.json({ error: "Invalid operator wallet address" }, 400);
    }
    if (safeAddress === undefined) {
      return c.json({ error: "Invalid Safe address" }, 400);
    }

    try {
      const { rows } = await pool.query<{ id: number; createdAt: string }>(
        `insert into "${APP_SCHEMA}".pilot_applications
          (operator_name, organization, machine_type, device_count, hardware_enclave, email, notes,
           operator_address, safe_address, status)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new')
          returning id, created_at as "createdAt"`,
        [
          operatorName,
          organization || null,
          machineType,
          deviceCount,
          hardwareEnclave || null,
          email,
          notes || null,
          operatorAddress,
          safeAddress,
        ],
      );
      const response: PilotApplicationResponse = { status: "received", data: rows[0] };
      return c.json(response, 201);
    } catch (error) {
      // Log the cause server-side only; database messages must not reach the client.
      console.error(
        "[PINELY Backend] Failed to record pilot application:",
        error instanceof Error ? error.message : error,
      );
      return c.json({ error: "Failed to record pilot application" }, 500);
    }
  },
);

export default pilotRoute;
