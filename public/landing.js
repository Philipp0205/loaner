/*
 * Loan some home page: entry routing and the invite code form.
 *
 * This is a classic script (not a module) and it is loaded in the head without defer or async, so a
 * signed-in or installed visitor is sent to the app before the home page body paints.
 * The decision itself is a pure function with no DOM use, so Node can import this file and test it.
 */
(function () {
  "use strict";

  var APP_PATH = "/app";
  var TOKEN_KEY = "loaner_token";
  var JOIN = /^\/join\/([A-Za-z0-9]+)\/?$/;

  /**
   * Which screen a visit gets.
   *  - input: { pathname, hash, signedIn, standalone }
   *  - result: { view: "landing" } or { view: "app", redirectTo: string | null }
   * At "/" (or "/landing.html") the home page only shows for a visitor who is signed out and not in the
   * installed app. At "/welcome" it always shows, signed in or not, installed or not, with no redirect.
   * Any other path is the app shell already (the welcome screen at /app, /join/<code> including a bad
   * code), so it needs no redirect.
   */
  function decideEntry(input) {
    var pathname = String((input && input.pathname) || "/");
    var hash = String((input && input.hash) || "");
    if (pathname === "/welcome" || pathname === "/welcome/") return { view: "landing" };
    var onLandingDoc = pathname === "/" || pathname === "/landing.html";
    if (!onLandingDoc) return { view: "app", redirectTo: null };
    if ((input && input.signedIn) || (input && input.standalone)) return { view: "app", redirectTo: APP_PATH + hash };
    return { view: "landing" };
  }

  /** The invite code from what a person typed or pasted: a bare code or a link ending /join/<code>. Null if it is neither. */
  function inviteCodeFrom(text) {
    var value = String(text || "").trim();
    var inLink = /\/join\/([A-Za-z0-9]+)\/?(?:[?#].*)?$/.exec(value);
    if (inLink) return inLink[1].toUpperCase();
    var bare = value.replace(/\s+/g, "");
    return /^[A-Za-z0-9]+$/.test(bare) ? bare.toUpperCase() : null;
  }

  function isStandalone() {
    try {
      if (window.navigator.standalone === true) return true;
      return ["standalone", "fullscreen"].some(function (mode) {
        return window.matchMedia("(display-mode: " + mode + ")").matches;
      });
    } catch (error) {
      return false;
    }
  }

  function isSignedIn() {
    try {
      return !!window.localStorage.getItem(TOKEN_KEY);
    } catch (error) {
      return false;
    }
  }

  var api = { APP_PATH: APP_PATH, JOIN: JOIN, decideEntry: decideEntry, inviteCodeFrom: inviteCodeFrom };
  globalThis.LoanerLanding = api;

  if (typeof document === "undefined" || typeof location === "undefined") return;

  var decision = decideEntry({ pathname: location.pathname, hash: location.hash, signedIn: isSignedIn(), standalone: isStandalone() });
  if (decision.redirectTo) {
    document.documentElement.hidden = true;
    location.replace(decision.redirectTo);
    return;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("invite");
    if (!form) return;
    var input = document.getElementById("invite-code");
    var error = document.getElementById("invite-error");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var code = inviteCodeFrom(input.value);
      if (!code) {
        error.textContent = "Enter the code from your invite link.";
        input.focus();
        return;
      }
      error.textContent = "";
      location.assign("/join/" + code);
    });
  });
})();
