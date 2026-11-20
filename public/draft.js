/**
 * The photos chosen on the camera screen, held in memory until the new item form is done.
 * `blobs` are already shrunk JPEGs, in the order they were added.
 */
let draft = { blobs: [] };

export const getDraft = () => draft;
export const setDraft = (next) => (draft = { blobs: [], ...next });
export const clearDraft = () => setDraft({});
