document.addEventListener('DOMContentLoaded', function () {
	const wrappers = document.querySelectorAll('.hide-block-wrapper');

	wrappers.forEach(function (wrapper) {
		const button = wrapper.querySelector('.open-hide-btn');
		const hiddenBlock = wrapper.querySelector('.is-hide-block');

		if (!button || !hiddenBlock) return;

		button.addEventListener('click', function () {
			const isOpen = wrapper.classList.contains('is-open');

				if (isOpen) {
					closeBlock(wrapper, hiddenBlock);
					button.querySelector('.hide-btn-txt').textContent = 'Показать дополнительные опции';
				} else {
					openBlock(wrapper, hiddenBlock);
					button.querySelector('.hide-btn-txt').textContent = 'Скрыть дополнительные опции';
				}
		});
		
	});

	function openBlock(wrapper, block) {
		wrapper.classList.add('is-open');

		block.style.height = block.scrollHeight + 'px';

		block.addEventListener('transitionend', function handler(e) {
			if (e.propertyName !== 'height') return;

			block.style.height = 'auto';
			block.removeEventListener('transitionend', handler);
		});
	}

	function closeBlock(wrapper, block) {
		block.style.height = block.scrollHeight + 'px';

		// Нужно, чтобы браузер успел применить текущую высоту
		block.offsetHeight;

		block.style.height = '0px';
		wrapper.classList.remove('is-open');
	}
});