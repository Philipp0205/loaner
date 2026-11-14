import { api } from "./api.js";
import { CHANGELOG } from "./changelog.js";
import { downscale } from "./photo.js";
import { showSheet } from "./sheet.js";
import { h } from "./util.js";
import { latestId } from "./whats-new.js";

export const FEEDBACK_MAX = 2000;

/** The Send feedback sheet, opened from the You tab. */
export function openFeedback() {
  let control = null;
  let sending = false;
  let photo = null;

  const title = h("h2", { id: "fb-title" }, "Send feedback");
  const help = h("p", { class: "muted small" }, "Ideas, bugs, anything. Your name is sent with it.");
  const head = h("div", { class: "sheet-head" }, h("div", { class: "grabber" }), title, help);

  const box = h("textarea", { id: "feedback-text", rows: "6", maxlength: String(FEEDBACK_MAX), placeholder: "What should we change?", "aria-describedby": "feedback-count" });
  const count = h("span", { class: "fb-count", id: "feedback-count" }, `0/${FEEDBACK_MAX}`);
  const error = h("p", { class: "error-text", id: "feedback-error", role: "alert" });
  const preview = h("div", { class: "fb-preview" });
  const file = h("input", { type: "file", id: "feedback-photo", accept: "image/jpeg,image/png,image/webp", "aria-label": "Attach a photo or screenshot" });
  const send = h("button", { type: "submit", class: "primary block", id: "feedback-send" }, "Send");

  const fail = (message) => {
    error.textContent = message;
    box.toggleAttribute("aria-invalid", !!message);
  };
  box.addEventListener("input", () => {
    count.textContent = `${box.value.length}/${FEEDBACK_MAX}`;
    fail("");
  });
  file.addEventListener("change", async () => {
    const picked = file.files[0];
    photo = null;
    preview.replaceChildren();
    if (!picked) return;
    try {
      photo = await downscale(picked);
      const remove = h("button", { type: "button", class: "link", onclick: () => { photo = null; file.value = ""; preview.replaceChildren(); } }, "Remove photo");
      preview.replaceChildren(h("img", { class: "fb-thumb", alt: "Attached photo preview", src: URL.createObjectURL(photo) }), remove);
    } catch (e) {
      file.value = "";
      fail(e.message);
    }
  });

  const form = h("form", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": "fb-title", novalidate: true },
    head,
    h("div", { class: "sheet-scroll" },
      h("label", { class: "field" }, h("span", null, "Your feedback"), box),
      h("div", { class: "fb-meta" }, error, count),
      h("div", { class: "field" }, h("span", null, "Photo or screenshot (optional)"), file, preview),
    ),
    h("div", { class: "sheet-dock" }, send),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (sending) return;
    const text = box.value.trim();
    if (!text) return fail("Write something first.");
    if (text.length > FEEDBACK_MAX) return fail(`Keep it under ${FEEDBACK_MAX} characters.`);
    sending = true;
    send.disabled = true;
    send.textContent = "Sending...";
    fail("");
    try {
      const { id } = await api("POST", "/api/feedback", { text, appVersion: latestId(CHANGELOG) });
      let photoFailed = false;
      if (photo) {
        try {
          await api("PUT", `/api/feedback/${id}/photo`, undefined, photo);
        } catch {
          photoFailed = true;
        }
      }
      thanks(photoFailed);
    } catch (e) {
      // Network or 429: say why and keep the draft where it is.
      fail(e.message || "Could not send. Try again.");
      sending = false;
      send.disabled = false;
      send.textContent = "Send";
    }
  });

  /** Swaps the form for a short thank you. The head stays, so swipe to close still works. */
  function thanks(photoFailed) {
    title.textContent = "Thanks!";
    help.textContent = photoFailed ? "Your message was sent, but the photo did not upload." : "We read every message.";
    form.classList.add("fb-done");
    form.querySelector(".sheet-scroll").remove();
    const done = h("button", { type: "button", class: "primary block", id: "feedback-done", onclick: () => control?.close() }, "Done");
    form.querySelector(".sheet-dock").replaceChildren(done);
    done.focus({ preventScroll: true });
  }

  control = showSheet(form, head, { focus: box });
}
