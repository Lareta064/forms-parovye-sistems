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
