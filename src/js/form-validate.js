document.addEventListener("DOMContentLoaded", function () {
//MASK PHONE
const PREFIX = "+7(";
function formatPhoneFromDigits(digits) {
	digits = digits.replace(/\D/g, "").slice(0, 11); // максимум 11 цифр (включая 7)
		let out = "+7(";
		if (digits.length > 1) out += digits.slice(1, 4);
		if (digits.length >= 4) out += ")" + digits.slice(4, 7);
		if (digits.length >= 7) out += "-" + digits.slice(7, 9);
		if (digits.length >= 9) out += "-" + digits.slice(9, 11);
		return out;
	}

	function getDigitsFromMasked(v) {
		return v.replace(/\D/g, "");
	}

	function setCaret(el, pos) {
		requestAnimationFrame(() => el.setSelectionRange(pos, pos));
	}

	document.querySelectorAll("input.phone").forEach(input => {
		// Автовставка префикса
		input.addEventListener("focus", () => {
			if (!input.value) {
			input.value = PREFIX;
			setCaret(input, PREFIX.length);
			}
	});

		// Блокируем перемещение курсора левее префикса
	input.addEventListener("click", () => {
		if (input.selectionStart < PREFIX.length) setCaret(input, PREFIX.length);
	});

	// На мобилках лучше перехватывать ввод до применения
	input.addEventListener("beforeinput", (e) => {
		// Разрешаем только цифры/удаление/вставку
		const allowed = ["insertText", "deleteContentBackward", "deleteContentForward", "insertFromPaste"];
		if (!allowed.includes(e.inputType)) return;

		const selStart = input.selectionStart ?? input.value.length;
		const selEnd = input.selectionEnd ?? selStart;

			// Не даём ломать фиксированный префикс
			if (selStart < PREFIX.length && e.inputType.startsWith("delete")) {
			e.preventDefault();
			return;
			}

			const currentDigits = getDigitsFromMasked(input.value);
			// Позицию в «чистых» цифрах вычислим грубо по количеству цифр слева от курсора
			const digitsLeft = getDigitsFromMasked(input.value.slice(0, selStart)).length;
			const digitsRight = getDigitsFromMasked(input.value.slice(selEnd)).length;

			let newDigitsLeft = currentDigits.slice(0, digitsLeft);
			let newDigitsRight = currentDigits.slice(currentDigits.length - digitsRight);

			if (e.inputType === "insertText") {
			// Разрешаем только цифры
			if (!/^\d$/.test(e.data)) { e.preventDefault(); return; }
			// Лимит 11 цифр
			if ((newDigitsLeft + e.data + newDigitsRight).length > 11) { e.preventDefault(); return; }
			newDigitsLeft += e.data;
			e.preventDefault();
			} else if (e.inputType === "insertFromPaste") {
			const pasted = (e.dataTransfer?.getData("text") ?? "").replace(/\D/g, "");
			if (!pasted) { e.preventDefault(); return; }
			const room = 11 - (newDigitsLeft + newDigitsRight).length;
			newDigitsLeft += pasted.slice(0, Math.max(0, room));
			e.preventDefault();
			} else if (e.inputType === "deleteContentBackward") {
			if (newDigitsLeft.length > 0) newDigitsLeft = newDigitsLeft.slice(0, -1);
			e.preventDefault();
			} else if (e.inputType === "deleteContentForward") {
			if (newDigitsRight.length > 0) newDigitsRight = newDigitsRight.slice(1);
			e.preventDefault();
			}

			const allDigits = newDigitsLeft + newDigitsRight;
			const masked = formatPhoneFromDigits(allDigits);
			input.value = masked;

			// Ставим каретку после той цифры, которую только что вводили/удаляли
			// Находим целевую позицию по количеству цифр слева
			const targetDigitsLeft = newDigitsLeft.length;
			// Пробегаем по маске, пока не наберём targetDigitsLeft цифр
			let caret = 0, count = 0;
			while (caret < masked.length && count < targetDigitsLeft) {
			if (/\d/.test(masked[caret])) count++;
			caret++;
			}
			// Не даём залезть в префикс
			if (caret < PREFIX.length) caret = PREFIX.length;
			setCaret(input, caret);
		});

		// На всякий случай — финальный форматтер (если что-то проскочит)
      input.addEventListener("input", () => {
        const masked = formatPhoneFromDigits(getDigitsFromMasked(input.value));
        if (masked !== input.value) input.value = masked;
      });
});
// FORM VALIDATION TEMPLATE
(function initFormValidation() {
  const ERROR_CLASS = "error";
  const ERROR_TEXT_CLASS = "error-text";

  // Ищем формы (можно оставить просто "form" если одна)
  const forms = document.querySelectorAll("form.js-validate-form");

  // Если у тебя нет класса js-validate-form, можно заменить на:
  // const forms = document.querySelectorAll("form");

  forms.forEach((form) => {
    const inputs = Array.from(form.querySelectorAll("input, textarea, select"));

    function getFormItem(input) {
      return input.closest(".form-item");
    }

    function getOrCreateErrorSpan(formItem) {
      if (!formItem) return null;

      let span = formItem.querySelector(`.${ERROR_TEXT_CLASS}`);
      if (!span) {
        span = document.createElement("span");
        span.className = ERROR_TEXT_CLASS;
        formItem.appendChild(span);
      }
      return span;
    }

    function setError(input, message) {
      const formItem = getFormItem(input);

      input.classList.add(ERROR_CLASS);
      if (formItem) formItem.classList.add(ERROR_CLASS);

      const span = getOrCreateErrorSpan(formItem);
      if (span) span.textContent = message;
    }

    function clearError(input) {
      const formItem = getFormItem(input);

      input.classList.remove(ERROR_CLASS);
      if (formItem) formItem.classList.remove(ERROR_CLASS);

      if (formItem) {
        const span = formItem.querySelector(`.${ERROR_TEXT_CLASS}`);
        if (span) span.remove();
      }
    }

    function isEmptyValue(input) {
      const value = (input.value ?? "").trim();

      // для телефона с префиксом +7( — считаем пустым, если кроме цифр ничего нет или введено мало
      if (input.classList.contains("phone")) {
        const digits = value.replace(/\D/g, "");
        // digits будет типа "7" если только префикс
        return digits.length <= 1;
      }

      return value.length === 0;
    }

    function validateEmailOnBlur(input) {
      // требование из задачи: если нет "@" => ошибка
      const v = (input.value ?? "").trim();
      if (v && !v.includes("@")) {
        setError(input, "Не верное значение");
      } else {
        // если исправили — снимаем ошибку
        clearError(input);
      }
    }

    // --- EVENTS ---

    // focus: "проверяем тип" — логика простая: если email, то активируем проверку на blur
    inputs.forEach((input) => {
      input.addEventListener("focus", () => {
        // ничего не делаем кроме понимания типа; проверка будет на blur
      });

      input.addEventListener("blur", () => {
        if (input.type === "email") {
          validateEmailOnBlur(input);
        }
      });

      // Чтобы ошибка уходила при исправлении
      input.addEventListener("input", () => {
        // Если уже было error — пробуем снять, когда поле стало не пустым
        if (input.classList.contains(ERROR_CLASS)) {
          // Для email — снимаем только если стало валидно по нашему правилу
          if (input.type === "email") {
            const v = (input.value ?? "").trim();
            if (!v) {
              // если пусто — пока не снимаем (submit покажет "Поле не заполнено" если required)
              clearError(input); // можно оставить/убрать — я убираю, чтобы не мешало
              return;
            }
            if (v.includes("@")) clearError(input);
          } else {
            if (!isEmptyValue(input)) clearError(input);
          }
        }
      });

      input.addEventListener("change", () => {
        if (!isEmptyValue(input)) clearError(input);
      });
    });

    // submit: required fields
    form.addEventListener("submit", (e) => {
      let hasErrors = false;

      const requiredFields = Array.from(form.querySelectorAll("[data-required]"));

      requiredFields.forEach((input) => {
        if (isEmptyValue(input)) {
          setError(input, "Поле не заполнено");
          hasErrors = true;
          return;
        }

        // Доп. проверка email при сабмите тоже (чтобы не зависело от blur)
        if (input.type === "email") {
          const v = (input.value ?? "").trim();
          if (v && !v.includes("@")) {
            setError(input, "Не верное значение");
            hasErrors = true;
            return;
          }
        }

        // если всё ок — чистим
        clearError(input);
      });

      if (hasErrors) {
        e.preventDefault();
		
  // 1) Находим первый инпут с ошибкой (можно и по .form-item.error, но так точнее)
  const firstErrorInput = form.querySelector("input.error, textarea.error, select.error");

  if (firstErrorInput) {
    // Если есть фиксированная шапка — можно добавить отступ
    const HEADER_OFFSET = 0; // например 80

    const y = firstErrorInput.getBoundingClientRect().top + window.pageYOffset - HEADER_OFFSET;

    window.scrollTo({
      top: y,
      behavior: "smooth",
    });

    // 2) Фокус в поле (не обязательно, но удобно)
    firstErrorInput.focus({ preventScroll: true });
  }
      }
    });
  });
})();

});