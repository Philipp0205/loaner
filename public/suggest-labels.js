import { CATEGORIES } from "./categories.js";

/** Loanable things the on-device model can pick from: [name, category]. Names are shown to the person as the suggestion. */
export const LABELS = [
  ["Cordless drill", "Tools"], ["Hammer", "Tools"], ["Screwdriver", "Tools"], ["Wrench", "Tools"], ["Pliers", "Tools"],
  ["Circular saw", "Tools"], ["Jigsaw", "Tools"], ["Sander", "Tools"], ["Ladder", "Tools"], ["Tape measure", "Tools"],
  ["Spirit level", "Tools"], ["Toolbox", "Tools"], ["Angle grinder", "Tools"], ["Pressure washer", "Tools"], ["Workbench vise", "Tools"],
  ["Shovel", "Garden"], ["Rake", "Garden"], ["Lawn mower", "Garden"], ["Hedge trimmer", "Garden"], ["Wheelbarrow", "Garden"],
  ["Garden hose", "Garden"], ["Leaf blower", "Garden"], ["Pruning shears", "Garden"],
  ["Blender", "Kitchen"], ["Frying pan", "Kitchen"], ["Stand mixer", "Kitchen"], ["Slow cooker", "Kitchen"], ["Food processor", "Kitchen"],
  ["Waffle iron", "Kitchen"], ["Raclette grill", "Kitchen"], ["Fondue set", "Kitchen"], ["Pasta machine", "Kitchen"],
  ["Tent", "Camping"], ["Sleeping bag", "Camping"], ["Camping stove", "Camping"], ["Cooler", "Camping"], ["Camping chair", "Camping"],
  ["Hiking backpack", "Camping"], ["Headlamp", "Camping"], ["Sleeping mat", "Camping"],
  ["Bicycle", "Sports"], ["Kayak", "Sports"], ["Helmet", "Sports"], ["Skis", "Sports"], ["Snowboard", "Sports"],
  ["Tennis racket", "Sports"], ["Football", "Sports"], ["Climbing harness", "Sports"], ["Paddleboard", "Sports"], ["Roller skates", "Sports"],
  ["Projector", "Electronics"], ["Camera", "Electronics"], ["Speaker", "Electronics"], ["Guitar", "Electronics"], ["Laptop", "Electronics"],
  ["Game console", "Electronics"], ["Drone", "Electronics"], ["Extension cord", "Electronics"],
  ["Board game", "Kids"], ["Stroller", "Kids"], ["Child car seat", "Kids"], ["Baby carrier", "Kids"], ["Toy", "Kids"],
  ["Vacuum cleaner", "Household"], ["Steam cleaner", "Household"], ["Iron", "Household"], ["Folding table", "Household"],
  ["Sewing machine", "Household"], ["Carpet cleaner", "Household"], ["Suitcase", "Household"], ["Fan", "Household"],
];

/** Below this softmax share the model is not sure, so we suggest nothing. */
export const MIN_SCORE = 0.2;

const BY_KEY = new Map(LABELS.map(([name, category]) => [name.toLowerCase(), { name, category }]));

/** The names sent to the model, in lower case. */
export const PROMPT_LABELS = LABELS.map(([name]) => name.toLowerCase());

/** The category for a suggested name, or "Other" when the name is not in the list. */
export function categoryFor(name) {
  const hit = BY_KEY.get(String(name).toLowerCase());
  return hit && CATEGORIES.includes(hit.category) ? hit.category : "Other";
}

/**
 * Picks the best entry from classifier output ([{ label, score }, ...], any order).
 * Returns { name, category, score } or null when nothing is known or the top score is weak.
 */
export function pickBest(results, minScore = MIN_SCORE) {
  if (!Array.isArray(results)) return null;
  let best = null;
  for (const entry of results) {
    if (!entry || typeof entry.score !== "number" || !Number.isFinite(entry.score)) continue;
    if (!BY_KEY.has(String(entry.label).toLowerCase())) continue;
    if (!best || entry.score > best.score) best = entry;
  }
  if (!best || best.score < minScore) return null;
  const hit = BY_KEY.get(String(best.label).toLowerCase());
  return { name: hit.name, category: categoryFor(hit.name), score: best.score };
}
