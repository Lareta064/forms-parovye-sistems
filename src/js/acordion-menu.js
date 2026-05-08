document.querySelectorAll(".acc__head").forEach((button) => {
  button.addEventListener("click", () => {
    const currentAcc = button.closest(".acc");
    const parentBody = currentAcc.parentElement;

    parentBody.querySelectorAll(":scope > .acc.is-open").forEach((acc) => {
      if (acc !== currentAcc) {
        acc.classList.remove("is-open");
      }
    });

    currentAcc.classList.toggle("is-open");
  });
});

(function () {
  const MOBILE_MAX = 768;

  function applyMobileLayout() {
    const isMobile = window.innerWidth < MOBILE_MAX;

    document
      .querySelectorAll(".calc-start-page .grid-column-main")
      .forEach((el) => {
        el.style.display = isMobile ? "none" : "";
      });

    document
      .querySelectorAll(".calculator-single .grid-column-sidebar")
      .forEach((el) => {
        el.style.display = isMobile ? "none" : "";
      });
  }

  applyMobileLayout();
  window.addEventListener("resize", applyMobileLayout);
})();
