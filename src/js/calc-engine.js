/*
 * Движок калькуляторов: связывает HTML-форму с математикой (window.CALC).
 * Форму помечаем data-calc="<код>". Поля ввода — data-var (+ data-cat для единиц).
 * Поля результата — data-out (+ data-cat). Единица читается из выбранного радио
 * в соседнем .dropdown--measure (текст .form-radio-name).
 * Конкатенируется в build/js/main.js — без import/export.
 */
(function () {
  'use strict';

  // Символ выбранной единицы для поля с измерительным dropdown.
  // Читаем текст кнопки dropdown (его поддерживает в актуальном состоянии dropdown.js) —
  // это надёжнее, чем :checked, который ломается при совпадении name у разных групп радио.
  function unitSymbol(scope) {
    var btn = scope.querySelector('.dropdown--measure .dropdown__button');
    if (btn) { var t = btn.textContent.trim(); if (t) return t; }
    var checked = scope.querySelector('.dropdown--measure input:checked');
    if (!checked) return '';
    var lbl = checked.closest('label');
    var name = lbl && lbl.querySelector('.form-radio-name');
    return name ? name.textContent.trim() : '';
  }

  // Группа-обёртка поля (для поиска его dropdown единиц).
  function groupOf(el) {
    return el.closest('.form-item-group') || el.closest('.calculator-result-row') || el.parentNode;
  }

  function readInputs(form) {
    var U = window.Units;
    var inp = { fittings: {} };
    form.querySelectorAll('[data-var]').forEach(function (el) {
      var name = el.getAttribute('data-var');
      var dtype = el.getAttribute('data-type');
      // Класс трубопровода / произвольный селект-индекс — value выбранного радио
      if (dtype === 'grade' || dtype === 'select') {
        var rg = el.querySelector('input[type="radio"]:checked');
        inp[name] = rg ? parseInt(rg.value, 10) : 0;
        return;
      }
      // Размер трубы — резолвим в внутренний диаметр (м) по числу в подписи (DN80->80, 25A->25).
      // Радио value ненадёжен как индекс таблицы (списки на страницах разные), поэтому ищем по подписи.
      if (dtype === 'size') {
        var rs = el.querySelector('input[type="radio"]:checked');
        inp[name] = rs ? parseInt(rs.value, 10) : 0;
        var pipe = pipeFromSize(form, el);
        if (pipe) { inp.pipeInDiam = pipe.id / 1000; inp.pipeOutDiam = pipe.od / 1000; } // поле pipeInDiam (если есть) перезапишет ID ниже
        return;
      }
      var raw = (el.value || '').trim();
      var cat = el.getAttribute('data-cat');
      // Фитинги и прочие безразмерные счётчики
      if (name.indexOf('fit.') === 0) {
        inp.fittings[name.slice(4)] = raw === '' ? 0 : U.parseNum(raw);
        return;
      }
      if (!cat) { inp[name] = raw === '' ? null : U.parseNum(raw); return; }
      // Необязательная температура: пусто -> null (использовать насыщение)
      if (raw === '') { inp[name] = null; return; }
      inp[name] = U.toSI(raw, cat, unitSymbol(groupOf(el)));
    });
    return inp;
  }

  function renderOutputs(form, out) {
    var U = window.Units;
    form.querySelectorAll('[data-out]').forEach(function (el) {
      var name = el.getAttribute('data-out');
      var val = out[name];
      if (val === undefined || val === null) return;
      var cat = el.getAttribute('data-cat');
      if (!cat) { setFieldText(el, typeof val === 'number' ? formatNum(val) : val); return; } // без единиц: число форматируем, строку (размер трубы) как есть
      el.dataset.si = val; // сохраняем СИ для пересчёта при смене единицы
      var sym = unitSymbol(groupOf(el));
      setFieldText(el, formatNum(U.fromSI(val, cat, sym)));
    });
    var block = form.querySelector('.calculator-form__result');
    if (block) block.classList.add('is-filled');
    if (out.exceeded) flagExceeded(form);
  }

  function setFieldText(el, v) {
    if ('value' in el && el.tagName === 'INPUT') el.value = v;
    else el.textContent = v;
  }

  function formatNum(n) {
    if (!isFinite(n)) return '—';
    var a = Math.abs(n);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return n.toExponential(4);
    return parseFloat(n.toPrecision(6)).toString();
  }

  function flagExceeded(form) {
    var msg = form.querySelector('[data-result-note]');
    if (msg) msg.textContent = 'Ни одна труба сортамента не укладывается в допустимые потери — показан наибольший типоразмер.';
  }

  // Символ единицы для конкретного radio (по тексту его .form-radio-name).
  function radioUnit(radio) {
    var lbl = radio.closest('label');
    var name = lbl && lbl.querySelector('.form-radio-name');
    return name ? name.textContent.trim() : '';
  }

  // Пересчёт поля результата при смене его единицы измерения.
  // Единицу берём из самого сработавшего radio (его .checked выставляется нативно
  // до любых слушателей), а не из текста кнопки dropdown — иначе ловим гонку:
  // обработчик движка регистрируется раньше dropdown.js и читает ещё старую подпись.
  function bindOutputUnitChange(form) {
    form.querySelectorAll('[data-out][data-cat]').forEach(function (el) {
      var grp = groupOf(el);
      grp.querySelectorAll('.dropdown--measure input').forEach(function (radio) {
        radio.addEventListener('change', function () {
          if (el.dataset.si === undefined) return;
          var sym = radioUnit(this) || unitSymbol(grp);
          setFieldText(el, formatNum(window.Units.fromSI(parseFloat(el.dataset.si), el.getAttribute('data-cat'), sym)));
        });
      });
    });
  }

  // Труба из PIPE_TABLE по выбранному размеру: ищем по числу в обозначении
  // (m: "80A" -> 80) совпадающему с числом в подписи (DN80/25A -> 80/25).
  function pipeFromSize(form, sizeEl) {
    if (!window.PIPE_TABLE) return null;
    var gradeEl = form.querySelector('[data-type="grade"]');
    var g = gradeEl ? (parseInt((gradeEl.querySelector('input:checked') || {}).value, 10) || 0) : 7;
    var checked = sizeEl.querySelector('input[type="radio"]:checked');
    if (!checked) return null;
    var nm = checked.closest('label').querySelector('.form-radio-name');
    var num = nm ? parseInt(nm.textContent.replace(/[^0-9]/g, ''), 10) : NaN;
    var list = window.PIPE_TABLE[g] || [];
    for (var i = 0; i < list.length; i++) {
      if (parseInt(list[i].m, 10) === num) return list[i];
    }
    return null;
  }
  // Внутренний диаметр (м) по выбранному размеру (для синхронизации поля).
  function diamFromSize(form, sizeEl) {
    var p = pipeFromSize(form, sizeEl);
    return p ? p.id / 1000 : null;
  }

  // Синхронизация поля внутреннего диаметра (если есть) при выборе класса/размера трубы.
  // Пользователь может переопределить значение вручную после синхронизации.
  function bindDiamSync(form) {
    var sizeEl = form.querySelector('[data-type="size"]');
    var diamField = form.querySelector('[data-var="pipeInDiam"]');
    if (!sizeEl || !diamField) return;
    var gradeEl = form.querySelector('[data-type="grade"]');
    function update() {
      var d = diamFromSize(form, sizeEl);
      if (d == null) return;
      diamField.value = formatNum(window.Units.fromSI(d, 'length', unitSymbol(groupOf(diamField))));
    }
    sizeEl.querySelectorAll('input').forEach(function (r) { r.addEventListener('change', update); });
    if (gradeEl) gradeEl.querySelectorAll('input').forEach(function (r) { r.addEventListener('change', update); });
    update();
  }

  // ----- Память значений между калькуляторами -----
  // Введённые значения (+ выбранная единица) сохраняются по data-var в localStorage,
  // чтобы при переходе на другой калькулятор общие поля (давление пара и т.п.) были
  // уже предзаполнены. Запоминаем только текстовые поля ввода; размер/класс трубы
  // (радио-группы) и синхронизируемый с размером pipeInDiam не трогаем.
  var MEM_KEY = 'calcFieldMemory';
  function memSkip(el) {
    var dt = el.getAttribute('data-type');
    if (dt === 'grade' || dt === 'select' || dt === 'size') return true;
    var name = el.getAttribute('data-var');
    return name === 'pipeInDiam' || name.indexOf('fit.') === 0;
  }
  function loadMem() { try { return JSON.parse(localStorage.getItem(MEM_KEY)) || {}; } catch (e) { return {}; } }
  function saveMem(m) { try { localStorage.setItem(MEM_KEY, JSON.stringify(m)); } catch (e) {} }
  // Выбрать в группе поля единицу по её символу (радио + нативно снимет выбор с соседей).
  function setGroupUnit(grp, sym) {
    if (!sym) return;
    grp.querySelectorAll('.dropdown--measure input[type="radio"]').forEach(function (r) {
      if (radioUnit(r) === sym) r.checked = true;
    });
  }
  function rememberField(el) {
    if (memSkip(el)) return;
    var raw = (el.value || '').trim();
    if (raw === '') return;
    var mem = loadMem();
    mem[el.getAttribute('data-var')] = { v: raw, u: el.getAttribute('data-cat') ? unitSymbol(groupOf(el)) : '' };
    saveMem(mem);
  }
  function restoreFields(form) {
    var mem = loadMem();
    form.querySelectorAll('input[data-var]').forEach(function (el) {
      if (memSkip(el)) return;
      var rec = mem[el.getAttribute('data-var')];
      if (!rec || rec.v == null || rec.v === '') return;
      if (rec.u) setGroupUnit(groupOf(el), rec.u); // до инициализации dropdown.js — подпись кнопки подхватится
      el.value = rec.v;
    });
  }
  function bindMemory(form) {
    form.querySelectorAll('input[data-var]').forEach(function (el) {
      if (memSkip(el)) return;
      el.addEventListener('input', function () { rememberField(el); });
      groupOf(el).querySelectorAll('.dropdown--measure input[type="radio"]').forEach(function (r) {
        r.addEventListener('change', function () { rememberField(el); });
      });
    });
  }

  function initForm(form) {
    var code = form.getAttribute('data-calc');
    if (!window.CALC || !window.CALC[code]) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      try {
        renderOutputs(form, window.CALC[code](readInputs(form)));
      } catch (err) {
        if (window.console) console.error('Ошибка расчёта ' + code, err);
      }
    });
    // Память не должна ломать расчёт — изолируем в try/catch.
    try { restoreFields(form); } catch (e) { if (window.console) console.warn('restoreFields', e); }
    bindOutputUnitChange(form);
    bindDiamSync(form);
    try { bindMemory(form); } catch (e) { if (window.console) console.warn('bindMemory', e); }
  }

  // ----- Конвертор единиц: форма [data-convert="<категория>"] -----
  // Ввод значения + единица (dropdown в группе поля [data-conv-in]) -> таблица всех единиц категории
  // в контейнер [data-conv-results].
  function initConverter(form) {
    var cat = form.getAttribute('data-convert');
    var inEl = form.querySelector('[data-conv-in]');
    var box = form.querySelector('[data-conv-results]');
    if (!cat || !inEl || !box || !window.Units) return;
    function run() {
      var sym = unitSymbol(groupOf(inEl));
      var si = window.Units.toSI(inEl.value, cat, sym);
      box.innerHTML = '';
      if (!isFinite(si)) return;
      window.Units.list(cat).forEach(function (u) {
        var val = formatNum(window.Units.fromSI(si, cat, u));
        var row = document.createElement('div');
        row.className = 'calculator-result-row conv-row';
        row.innerHTML = '<span class="conv-row__unit">' + u + '</span><span class="conv-row__val">' + val + '</span>';
        box.appendChild(row);
      });
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); run(); });
    inEl.addEventListener('input', run);
    groupOf(inEl).querySelectorAll('.dropdown--measure input').forEach(function (r) { r.addEventListener('change', run); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-calc]').forEach(initForm);
    document.querySelectorAll('[data-convert]').forEach(initConverter);
  });
})();
