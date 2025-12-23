// document.addEventListener("DOMContentLoaded", function () {

//   document.querySelectorAll('.dropdown').forEach(function (dropDownWrapper) {
//     const dropDownBtn = dropDownWrapper.querySelector('.dropdown__button');
//     const dropDownList = dropDownWrapper.querySelector('.dropdown__list');

//     // Берём все радио внутри
//     const radios = dropDownWrapper.querySelectorAll('input[type="radio"]');

//     // Функции открыть/закрыть
//     function openDropdown() {
//       dropDownList.style.height = dropDownList.scrollHeight + 'px';
//       dropDownList.classList.add('dropdown__list--visible');
//       dropDownBtn.classList.add('dropdown__button--active');
//       dropDownWrapper.classList.add('dropdown-active');
//       dropDownBtn.setAttribute('aria-expanded', 'true');
//     }

//     function closeDropdown() {
//       dropDownList.classList.remove('dropdown__list--visible');
//       dropDownList.style.height = 0;
//       dropDownBtn.classList.remove('dropdown__button--active');
//       dropDownWrapper.classList.remove('dropdown-active');
//       dropDownBtn.setAttribute('aria-expanded', 'false');
//     }

//     function setButtonTextFromRadio(radio) {
//       // label -> span (или просто label.textContent)
//       const label = radio.closest('label');
//       const textEl = label ? label.querySelector('span') : null;
//       dropDownBtn.innerText = textEl ? textEl.innerText.trim() : (label ? label.innerText.trim() : '');
//     }

//     // Инициализация текста кнопки по checked
//     const checked = dropDownWrapper.querySelector('input[type="radio"]:checked');
//     if (checked) setButtonTextFromRadio(checked);

//     // Клик по кнопке
//     dropDownBtn.addEventListener('click', function (e) {
//       if (dropDownList.classList.contains('dropdown__list--visible')) {
//         closeDropdown();
//       } else {
//         openDropdown();
//       }
//     });

//     // Выбор радио (клик по label тоже сработает)
//     radios.forEach(function (radio) {
//       radio.addEventListener('change', function () {
//         setButtonTextFromRadio(this);
//         dropDownBtn.focus();
//         closeDropdown();
//       });
//     });

//     // Клик снаружи
//     document.addEventListener('click', function (e) {
//       if (!dropDownWrapper.contains(e.target)) {
//         closeDropdown();
//       }
//     });

//     // Tab / Escape
//     document.addEventListener('keydown', function (e) {
//       if (e.key === 'Tab' || e.key === 'Escape') {
//         closeDropdown();
//       }
//     });
//   });

// });
document.addEventListener("DOMContentLoaded", function () {

  document.querySelectorAll('.dropdown').forEach(function (dropDownWrapper) {
    const dropDownBtn  = dropDownWrapper.querySelector('.dropdown__button');
    const dropDownList = dropDownWrapper.querySelector('.dropdown__list');

    const inputs = dropDownWrapper.querySelectorAll('input[type="radio"], input[type="checkbox"]');
    if (!inputs.length) return;

    const placeholder = dropDownWrapper.dataset.placeholder || dropDownBtn.innerText.trim();

    function openDropdown() {
      dropDownList.style.height = dropDownList.scrollHeight + 'px';
      dropDownList.classList.add('dropdown__list--visible');
      dropDownBtn.classList.add('dropdown__button--active');
      dropDownWrapper.classList.add('dropdown-active');
      dropDownBtn.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown() {
      dropDownList.classList.remove('dropdown__list--visible');
      dropDownList.style.height = 0;
      dropDownBtn.classList.remove('dropdown__button--active');
      dropDownWrapper.classList.remove('dropdown-active');
      dropDownBtn.setAttribute('aria-expanded', 'false');
    }

    function getLabelText(input) {
      const label = input.closest('label');
      if (!label) return '';
      const span = label.querySelector('span');
      return (span ? span.innerText : label.innerText).trim();
    }

    function updateButtonText() {
      const checked = dropDownWrapper.querySelectorAll('input:checked');
      if (!checked.length) {
        dropDownBtn.innerText = placeholder;
        return;
      }

      // Определяем режим: radio или checkbox
      const isRadio = checked[0].type === 'radio';

      if (isRadio) {
        dropDownBtn.innerText = getLabelText(checked[0]);
      } else {
        const texts = Array.from(checked).map(getLabelText).filter(Boolean);
        dropDownBtn.innerText = texts.length ? texts.join(', ') : placeholder;
      }
    }

    // Инициализация
    updateButtonText();

    // Открыть/закрыть по кнопке
    dropDownBtn.addEventListener('click', function () {
      if (dropDownList.classList.contains('dropdown__list--visible')) {
        closeDropdown();
      } else {
        openDropdown();
      }
    });

    // Реакция на выбор
    inputs.forEach(function (input) {
      input.addEventListener('change', function () {
        updateButtonText();

        // Если radio — закрываем сразу (как селект)
        if (this.type === 'radio') {
          dropDownBtn.focus();
          closeDropdown();
        }
        // Если checkbox — обычно НЕ закрывают, чтобы можно было выбрать несколько.
        // Но если тебе нужно закрывать — скажи, добавим опцию.
      });
    });

    // Клик снаружи — закрыть
    document.addEventListener('click', function (e) {
      if (!dropDownWrapper.contains(e.target)) {
        closeDropdown();
      }
    });

    // Tab/Escape — закрыть
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' || e.key === 'Escape') {
        closeDropdown();
      }
    });
  });

});

