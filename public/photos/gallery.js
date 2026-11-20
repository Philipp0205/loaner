import { photoEl, photoElAt } from "../photo.js";
import { openPhotoViewer, viewable } from "../photo-viewer.js";
import { h } from "../util.js";
import { counterText, slideLabel } from "./copy.js";
import { indexFromScroll } from "./pure.js";

/** One tappable slide. Tapping opens the viewer on this photo, with every photo that has loaded. */
function slideFor(item, id, index, total, slides) {
  const img = photoElAt(item, id, "big viewable");
  img.setAttribute("role", "button");
  img.setAttribute("tabindex", "0");
  img.setAttribute("aria-label", `View ${slideLabel(index, total).toLowerCase()} of ${item.name}`);
  const open = () => {
    const sources = slides.map((s) => s.src).filter(Boolean);
    const at = sources.indexOf(img.src);
    if (img.src) openPhotoViewer(sources, item.name, img, Math.max(0, at));
  };
  img.addEventListener("click", open);
  img.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });
  return img;
}

/** The photo(s) at the top of the item page. One photo looks and acts as it always did; more become a swipeable gallery. */
export function photoGallery(item) {
  const ids = item.photoIds || [];
  if (!item.hasPhoto) return photoEl(item, "big");
  if (ids.length <= 1) return viewable(photoEl(item, "big"), item);
  const slides = [];
  const track = h("div", { class: "gal-track" });
  ids.forEach((id, index) => slides.push(slideFor(item, id, index, ids.length, slides)));
  track.append(...slides);
  const counter = h("p", { class: "gal-count", "data-gallery-count": "", role: "status" }, counterText(0, ids.length));
  const dots = h("div", { class: "gal-dots", "aria-hidden": "true" }, ids.map(() => h("span", { class: "gal-dot" })));
  const show = (index) => {
    counter.textContent = counterText(index, ids.length);
    [...dots.children].forEach((dot, at) => dot.classList.toggle("on", at === index));
  };
  track.addEventListener("scroll", () => show(indexFromScroll(track.scrollLeft, track.clientWidth, ids.length)));
  show(0);
  return h("div", { class: "gallery", "data-gallery": "" }, track, counter, dots);
}
