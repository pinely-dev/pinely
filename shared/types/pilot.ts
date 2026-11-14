/**
 * Pilot application contract shared by the frontend form and the backend route
 * (`POST /api/pilot/applications`). Keeping the enums and limits in one place stops the two sides
 * from drifting apart.
 */

export const PILOT_MACHINE_TYPES = [
  "Autonomous Delivery Rover",
  "Drone / Aerial Fleet",
  "Commercial EV Station",
  "Warehouse AMR / AGV",
  "Smart Infrastructure / Locker",
  "Other Physical AI",
] as const;

export const PILOT_HARDWARE_ENCLAVES = [
  "NXP SE050 TPM",
  "STSAFE-A110",
  "Microchip ATECC608",
  "Infineon OPTIGA TPM",
  "Software Keystore / Testing",
] as const;

export const PILOT_LIMITS = {
  operatorName: 120,
  organization: 160,
  email: 254,
  notes: 2000,
  maxDevices: 100_000,
} as const;

export type PilotMachineType = (typeof PILOT_MACHINE_TYPES)[number];
export type PilotHardwareEnclave = (typeof PILOT_HARDWARE_ENCLAVES)[number];

export interface PilotApplicationRequest {
  operatorName: string;
  organization?: string;
  email: string;
  machineType: PilotMachineType;
  deviceCount: number;
  hardwareEnclave?: PilotHardwareEnclave;
  /** The operator's wallet. Optional; checked and normalised to a checksum address by the backend. */
  operatorAddress?: string;
  /** The operator's Safe multisig. Optional; checked and normalised the same way. */
  safeAddress?: string;
  notes?: string;
}

export interface PilotApplicationResponse {
  status: "received";
  data: { id: number; createdAt: string };
}
