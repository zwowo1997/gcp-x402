import { createHash } from "node:crypto";
import { type V3Simulation, type V3SimulationStatus } from "@/lib/v3";

const simulations = new Map<string, V3Simulation>();
const owners = new Map<string, string>();
const requestsBySession = new Map<string, number[]>();
const WINDOW_MS = 60 * 60_000;
const MAX_NEW_SIMULATIONS_PER_HOUR = 8;

function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function nowIso() { return new Date().toISOString(); }
function sessionKey(session: string | null): string { return createHash("sha256").update(session ?? "anonymous").digest("hex"); }

function expireIfNeeded(simulation: V3Simulation): V3Simulation {
  if (!["shutdown", "expired"].includes(simulation.status) && new Date(simulation.expiresAt).getTime() <= Date.now()) {
    simulation.status = "expired";
    simulation.timeline.push({ state: "expired", at: nowIso(), detail: "Simulation lease ended automatically. No cloud resource or payment needed cleanup." });
  }
  return simulation;
}

export function limitV3Simulation(session: string | null): void {
  const key = sessionKey(session);
  const now = Date.now();
  const active = (requestsBySession.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  if (active.length >= MAX_NEW_SIMULATIONS_PER_HOUR) throw new Error("Simulation rate limit reached. Try again after an hour.");
  active.push(now);
  requestsBySession.set(key, active);
}

export function saveV3Simulation(simulation: V3Simulation, session: string | null): V3Simulation {
  simulations.set(simulation.stackId, copy(simulation));
  owners.set(simulation.stackId, sessionKey(session));
  return copy(simulation);
}

export function getV3Simulation(stackId: string, session: string | null): V3Simulation | null {
  const simulation = simulations.get(stackId);
  if (!simulation || owners.get(stackId) !== sessionKey(session)) return null;
  expireIfNeeded(simulation);
  return copy(simulation);
}

export function transitionV3Simulation(stackId: string, session: string | null, action: "approve" | "fund" | "provision" | "stop" | "resume" | "shutdown" | "cancel"): V3Simulation {
  const simulation = simulations.get(stackId);
  if (!simulation || owners.get(stackId) !== sessionKey(session)) throw new Error("Simulation not found or it belongs to another beta session.");
  expireIfNeeded(simulation);
  if (simulation.status === "expired") throw new Error("Simulation expired. Start a new checkout rehearsal.");
  const at = nowIso();
  const add = (state: string, detail: string) => simulation.timeline.push({ state, detail, at });
  const requireState = (...states: V3SimulationStatus[]) => {
    if (!states.includes(simulation.status)) throw new Error(`Cannot ${action} while simulation is ${simulation.status}.`);
  };
  switch (action) {
    case "approve":
      requireState("checkout");
      simulation.status = "approved"; simulation.paymentStatus = "authorized"; simulation.mandate.status = "approved"; simulation.onramp.state = "approved";
      add("mandate_approved", `User approved a simulated Apple Pay authorization up to $${simulation.quote.authorizationCapUsd.toFixed(2)} USDC.`);
      break;
    case "fund":
      requireState("approved");
      simulation.status = "funded"; simulation.paymentStatus = "funded"; simulation.onramp.state = "funded_simulated";
      add("embedded_wallet_funded", "Coinbase sandbox funding completed in simulation. No fiat charge or USDC transfer occurred.");
      break;
    case "provision":
      requireState("funded");
      simulation.status = "running"; simulation.paymentStatus = "settled_simulated"; simulation.mandate.status = "consumed";
      add("provisioning_completed", `Simulated infrastructure is running. A future real flow would settle $${simulation.quote.expectedChargeUsd.toFixed(2)} USDC only after provisioning succeeds.`);
      break;
    case "stop":
      requireState("running"); simulation.status = "stopped"; add("strategy_stopped", "Paper strategy and simulated feed consumers stopped."); break;
    case "resume":
      requireState("stopped"); simulation.status = "running"; add("strategy_resumed", "Paper strategy and simulated feed consumers resumed."); break;
    case "shutdown":
      requireState("checkout", "approved", "funded", "running", "stopped"); simulation.status = "shutdown";
      if (simulation.paymentStatus !== "settled_simulated") simulation.paymentStatus = "cancelled";
      if (simulation.mandate.status === "draft" || simulation.mandate.status === "approved") simulation.mandate.status = "cancelled";
      add("shutdown", "Simulation shut down. No cloud resources or funds required cleanup."); break;
    case "cancel":
      requireState("checkout", "approved", "funded"); simulation.status = "shutdown"; simulation.paymentStatus = "cancelled"; simulation.mandate.status = "cancelled";
      add("checkout_cancelled", "Checkout rehearsal cancelled before simulated provisioning."); break;
  }
  return saveV3Simulation(simulation, session);
}
