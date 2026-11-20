import { MAX_PHOTOS } from "./limits.js";

/** Every string the photo screens show. */
export const PHOTO_COPY = {
  addPhotos: "Add photos",
  fromGallery: "From gallery",
  removePhoto: "Remove photo",
  removed: "Photo removed",
  noPhotos: "No photos yet",
  onlySome: `Only ${MAX_PHOTOS} photos fit, so some were left out.`,
  full: `That is already ${MAX_PHOTOS} photos. Remove one to add another.`,
  uploadFailed: "Your item was saved, but a photo did not upload. Add it again from here.",
  working: "Preparing the photos...",
};

/** "2 of 6 photos" under the picker. */
export function pickerCount(count) {
  return `${count} of ${MAX_PHOTOS} photos`;
}

/** "Photo 2 of 3", for the label of one gallery slide or thumbnail. */
export function slideLabel(index, total) {
  return `Photo ${index + 1} of ${total}`;
}

/** "2 / 3", the counter on the gallery and in the full screen viewer. */
export function counterText(index, total) {
  return `${index + 1} / ${total}`;
}
