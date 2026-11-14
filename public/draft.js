/** The photo, name and category chosen on the camera screen, held in memory until the form is done. */
let draft = { blob: null, name: "", category: "" };

export const getDraft = () => draft;
export const setDraft = (next) => { draft = { blob: null, name: "", category: "", ...next }; };
export const clearDraft = () => setDraft({});
