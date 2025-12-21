// document.addEventListener("DOMContentLoaded", function () {
// (function () {
//   // Настройка: отступ от верхнего края экрана (например, высота шапки сайта)
//   //можно прописать в html  .fieldset-sticky-header( data-sticky-top="72")
//   const DEFAULT_TOP_OFFSET = 0; // можно поменять глобально

//   const sections = document.querySelectorAll(
//     ".custom-form .fieldset-group.fieldset-sticky-header"
//   );

//   if (!sections.length) return;

//   const state = new Map();

//   function initSection(section) {
//     const title = section.querySelector(".fieldset-sticky-title");
//     if (!title) return;

//     // Можно задавать индивидуально на секции:
//     // <div class="fieldset-group fieldset-sticky-header" data-sticky-top="72">
//     const topOffset =
//       Number(section.dataset.stickyTop ?? DEFAULT_TOP_OFFSET) || 0;

//     // Плейсхолдер, чтобы при fixed не схлопывалось место
//     const ph = document.createElement("div");
//     ph.style.display = "none";
//     section.insertBefore(ph, title);

//     state.set(section, {
//       section,
//       title,
//       ph,
//       topOffset,
//       lastWidth: null,
//       lastLeft: null,
//     });
//   }

//   sections.forEach(initSection);

//   function setFixed(s, rectTitle) {
//     const { title, ph, topOffset } = s;

//     // включаем плейсхолдер на высоту заголовка
//     ph.style.display = "";
//     ph.style.height = `${rectTitle.height}px`;

//     // фиксируем
//     title.classList.add("is-fixed");
//     title.classList.remove("is-bottom");

//     title.style.top = `${topOffset}px`;
//   }

//   function setBottom(s, rectSection, rectTitle) {
//     const { title, ph } = s;

//     // плейсхолдер оставляем, т.к. title всё ещё "вынут" из потока
//     ph.style.display = "";
//     ph.style.height = `${rectTitle.height}px`;

//     title.classList.remove("is-fixed");
//     title.classList.add("is-bottom");

//     // absolute относительно section
//     sectionEnsureRelative(s.section);

//     title.style.top = `${rectSection.height - rectTitle.height}px`;
//     title.style.left = "0px";
//     title.style.width = "100%";
//   }

//   function setNormal(s) {
//     const { title, ph } = s;

//     ph.style.display = "none";
//     ph.style.height = "0px";

//     title.classList.remove("is-fixed", "is-bottom");
//     title.style.top = "";
//     title.style.left = "";
//     title.style.width = "";
//   }

//   function sectionEnsureRelative(section) {
//     const cs = getComputedStyle(section);
//     if (cs.position === "static") {
//       section.style.position = "relative";
//     }
//   }

//   function alignFixedToSection(s) {
//     const { section, title } = s;
//     const r = section.getBoundingClientRect();

//     // фиксируем заголовок по ширине/левому краю секции, чтобы совпадал с таблицей/гридом
//     title.style.left = `${r.left}px`;
//     title.style.width = `${r.width}px`;
//   }

//   let ticking = false;

//   function onScrollOrResize() {
//     if (ticking) return;
//     ticking = true;

//     requestAnimationFrame(() => {
//       state.forEach((s) => {
//         const rectSection = s.section.getBoundingClientRect();
//         const rectTitle = s.title.getBoundingClientRect();

//         const topLine = s.topOffset; // линия "прилипания" на экране
//         const sectionTop = rectSection.top;
//         const sectionBottom = rectSection.bottom;

//         // Условия:
//         // - Фиксируем, если верх секции уже ушел выше линии topLine,
//         //   но низ секции ещё ниже линии topLine + высота title (иначе пора прижимать к низу)
//         const shouldFix = sectionTop <= topLine;
//         const shouldBottom = sectionBottom <= topLine + rectTitle.height;

//         // Если секция вообще не пересекается с окном — приводим к normal
//         // (можно и не делать, но так чище)
//         const isVisible = sectionBottom > 0 && sectionTop < window.innerHeight;

//         if (!isVisible) {
//           setNormal(s);
//           return;
//         }

//         if (!shouldFix) {
//           // мы ещё "до" секции
//           setNormal(s);
//           return;
//         }

//         if (shouldBottom) {
//           // дошли до конца секции
//           setBottom(s, rectSection, rectTitle);
//           return;
//         }

//         // обычный fixed
//         setFixed(s, rectTitle);
//         alignFixedToSection(s);
//       });

//       ticking = false;
//     });
//   }

//   window.addEventListener("scroll", onScrollOrResize, { passive: true });
//   window.addEventListener("resize", onScrollOrResize);

//   // первичный прогон
//   onScrollOrResize();
// })();
// })