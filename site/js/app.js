(function () {
  const banner = document.getElementById("banner");
  const dismiss = () => { banner.hidden = true; sessionStorage.setItem("og-ack", "1"); };
  if (sessionStorage.getItem("og-ack") === "1") banner.hidden = true;
  document.getElementById("banner-ok").addEventListener("click", dismiss);
  document.getElementById("about-btn").addEventListener("click", () => { banner.hidden = false; });
  const status = document.getElementById("status");
  if (status) status.textContent = "The hierarchy artefacts are not in this build yet.";
})();
