export const NO_NAME = "No name suggested. Type one in.";
export const STILL_LOOKING = "Still looking at the photo. A name may appear here if you have not typed one.";
const SUGGESTED = "Suggested from your photo. Change it if it is wrong.";

/**
 * The photo, name and category chosen on the camera screen, held in memory until the form is done.
 * `hint` is a quiet note for the form. `touched` is set once the person edits the name.
 * `onchange` is set by the open form, so a late suggestion can show up in it.
 */
let draft = { blob: null, name: "", category: "", hint: "", touched: false, onchange: null };

export const getDraft = () => draft;
export const setDraft = (next) => (draft = { blob: null, name: "", category: "", hint: "", touched: false, onchange: null, ...next });
export const clearDraft = () => setDraft({});

/**
 * A suggestion that arrived after the form opened. It fills the name only if the person has not touched it,
 * and the category only if none is chosen. Ignored when `d` is no longer the current draft.
 */
export function lateGuess(d, guess) {
  if (draft !== d) return;
  if (guess && !d.touched && !d.name) {
    d.name = guess.name;
    if (!d.category) d.category = guess.category;
    d.hint = SUGGESTED;
  } else {
    d.hint = d.touched || d.name ? "" : NO_NAME;
  }
  if (d.onchange) d.onchange();
}
