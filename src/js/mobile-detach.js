// Удаляет тяжёлые блоки калькуляторов из DOM на экранах <=767px и возвращает
// их на место при возврате к десктопу. Запускается ПОСЛЕ acordion-menu.js
// (алфавитный порядок конкатенации), чтобы слушатели .acc__head успели
// привязаться к кнопкам внутри .grid-column-sidebar до того, как контейнер
// будет отсоединён — replaceWith сохраняет узел и его слушатели.
(function () {
  const mql = window.matchMedia("(max-width: 767px)");

  const targets = [
    ...document.querySelectorAll(".calc-start-page .grid-column-main"),
    ...document.querySelectorAll(".calculator-single .grid-column-sidebar"),
  ].map((node) => ({
    node,
    placeholder: document.createComment("mobile-detached"),
  }));

  function apply(isMobile) {
    targets.forEach(({ node, placeholder }) => {
      if (isMobile) {
        if (node.isConnected) node.replaceWith(placeholder);
      } else {
        if (placeholder.isConnected) placeholder.replaceWith(node);
      }
    });
  }

  apply(mql.matches);
  mql.addEventListener("change", (e) => apply(e.matches));
})();
