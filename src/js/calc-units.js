/*
 * Конверсия единиц измерения для калькуляторов.
 * В units.json из APK множителей нет (только символы), поэтому коэффициенты заданы здесь.
 * Каждая категория приводит значение к своей базовой СИ-единице (toSI) и обратно (fromSI).
 * Символы единиц совпадают с текстом .form-radio-name в выпадающих списках форм.
 * Конкатенируется в build/js/main.js — без import/export.
 *
 * Базовые единицы СИ по категориям:
 *   pressureAbs -> МПа (абсолютное)   |  dPress -> Па      |  temp -> К
 *   massFlow    -> кг/ч               |  length -> м       |  velocity -> м/с
 */
(function () {
  'use strict';

  var ATM = 0.101325; // атмосферное давление, МПа

  // Абсолютное/манометрическое давление -> МПа абс.  {f: множитель в МПа, off: добавка (атм для манометрических)}
  var pressureAbs = {
    'kPa abs': { f: 0.001, off: 0 }, 'MPa abs': { f: 1, off: 0 }, 'psi abs': { f: 0.00689476, off: 0 },
    'bar abs': { f: 0.1, off: 0 }, 'kg/cm² abs': { f: 0.0980665, off: 0 }, 'mmHg abs': { f: 0.000133322, off: 0 },
    'kPaG': { f: 0.001, off: ATM }, 'MPaG': { f: 1, off: ATM }, 'psig': { f: 0.00689476, off: ATM },
    'barG': { f: 0.1, off: ATM }, 'kg/cm²G': { f: 0.0980665, off: ATM }, 'mmHgG': { f: 0.000133322, off: ATM }
  };
  // Перепад/потери давления -> Па (без gauge)
  var dPress = {
    'kPa': 1000, 'MPa': 1e6, 'psi': 6894.76, 'bar': 1e5, 'kg/cm²': 98066.5, 'mmHg': 133.322, 'Pa': 1
  };
  // Массовый расход -> кг/ч
  var massFlow = { 'kg/h': 1, 't(metric)/h': 1000, 'lb/h': 0.453592 };
  // Масса -> кг
  var mass = { 'kg': 1, 'g': 0.001, 't(metric)': 1000, 'lb': 0.453592 };
  // Время -> часы
  var time = { 'h': 1, 'min': 1 / 60, 'sec': 1 / 3600 };
  // Объём -> м³
  var volume = {
    'm³': 1, 'mm³': 1e-9, 'cm³(=mL)': 1e-6, 'cm³': 1e-6, 'dm³(=L)': 0.001, 'L': 0.001, 'l': 0.001,
    'gal': 0.00378541, 'gal (US)': 0.00378541, 'gal (UK)': 0.00454609,
    'in³': 1.6387064e-5, 'ft³': 0.0283168466, 'yd³': 0.764554858, 'barrel': 0.158987295
  };
  // Длина / шероховатость -> м
  var length = { 'mm': 0.001, 'cm': 0.01, 'm': 1, 'in': 0.0254, 'ft': 0.3048, 'yd': 0.9144 };
  // Скорость -> м/с
  var velocity = { 'm/s': 1, 'ft/s': 0.3048, 'km/h': 0.277777778, 'mile/h': 0.44704 };
  // Коэффициент пропускной способности клапана -> Cv(US).  Kv = 0.865·Cv(US); Cv(UK) на имп. галлонах.
  var cv = { 'Cv(US)': 1, 'Cv': 1, 'Cv(UK)': 1.20095, 'Kv': 1.15607 };
  // Удельная теплоёмкость -> кДж/(кг·К). 1 ккал/кг°C = 1 BTU/lb°F = 4.1868 кДж/кг·К.
  var specHeat = { 'kJ/kg K': 1, 'kJ/kg·K': 1, 'kcal/kg·°C': 4.1868, 'BTU/lb °F': 4.1868 };
  // Удельная энтальпия/теплота -> кДж/кг.
  var enthalpy = { 'kJ/kg': 1, 'kcal/kg': 4.1868, 'BTU/lb': 2.326 };
  // Удельный объём -> м³/кг.
  var specVol = { 'm³/kg': 1, 'L/kg': 0.001, 'cm³/g': 0.001, 'ft³/lb': 0.0624279606 };
  // Динамическая вязкость -> мПа·с.
  var dynVisc = { 'mPa·s': 1, 'Pa·s': 1000, 'cP': 1, 'µPa·s': 0.001 };
  // Тепловой поток / мощность -> Вт.
  var power = { 'W': 1, 'kW': 1000, 'kcal/h': 1.163, 'BTU/h': 0.293071 };
  // Объёмный расход -> м³/ч. Галлоны — US.
  var volFlow = { 'm³/h': 1, 'l/h': 0.001, 'gal/h': 0.00378541, 'GPM': 0.227125, 'm³/min': 60, 'l/min': 0.06, 'L/min': 0.06, 'CFM': 1.69901, 'ft³/min': 1.69901 };

  function toSI(value, category, symbol) {
    var v = parseFloat(value);
    if (isNaN(v)) return NaN;
    symbol = (symbol || '').trim();
    switch (category) {
      case 'pressureAbs': { var p = pressureAbs[symbol]; return p ? v * p.f + p.off : NaN; }
      case 'dPress': return symbol in dPress ? v * dPress[symbol] : NaN;
      case 'massFlow': return symbol in massFlow ? v * massFlow[symbol] : NaN;
      case 'mass': return symbol in mass ? v * mass[symbol] : NaN;
      case 'length': return symbol in length ? v * length[symbol] : NaN;
      case 'velocity': return symbol in velocity ? v * velocity[symbol] : NaN;
      case 'cv': return symbol in cv ? v * cv[symbol] : NaN;
      case 'specHeat': return symbol in specHeat ? v * specHeat[symbol] : NaN;
      case 'enthalpy': return symbol in enthalpy ? v * enthalpy[symbol] : NaN;
      case 'specVol': return symbol in specVol ? v * specVol[symbol] : NaN;
      case 'dynVisc': return symbol in dynVisc ? v * dynVisc[symbol] : NaN;
      case 'power': return symbol in power ? v * power[symbol] : NaN;
      case 'volFlow': return symbol in volFlow ? v * volFlow[symbol] : NaN;
      case 'time': return symbol in time ? v * time[symbol] : NaN;
      case 'volume': return symbol in volume ? v * volume[symbol] : NaN;
      case 'temp':
        if (symbol === '°C') return v + 273.15;
        if (symbol === 'K') return v;
        if (symbol === '°F') return (v - 32) * 5 / 9 + 273.15;
        return NaN;
      default: return NaN;
    }
  }

  function fromSI(si, category, symbol) {
    symbol = (symbol || '').trim();
    switch (category) {
      case 'pressureAbs': { var p = pressureAbs[symbol]; return p ? (si - p.off) / p.f : NaN; }
      case 'dPress': return symbol in dPress ? si / dPress[symbol] : NaN;
      case 'massFlow': return symbol in massFlow ? si / massFlow[symbol] : NaN;
      case 'mass': return symbol in mass ? si / mass[symbol] : NaN;
      case 'length': return symbol in length ? si / length[symbol] : NaN;
      case 'velocity': return symbol in velocity ? si / velocity[symbol] : NaN;
      case 'cv': return symbol in cv ? si / cv[symbol] : NaN;
      case 'specHeat': return symbol in specHeat ? si / specHeat[symbol] : NaN;
      case 'enthalpy': return symbol in enthalpy ? si / enthalpy[symbol] : NaN;
      case 'specVol': return symbol in specVol ? si / specVol[symbol] : NaN;
      case 'dynVisc': return symbol in dynVisc ? si / dynVisc[symbol] : NaN;
      case 'power': return symbol in power ? si / power[symbol] : NaN;
      case 'volFlow': return symbol in volFlow ? si / volFlow[symbol] : NaN;
      case 'time': return symbol in time ? si / time[symbol] : NaN;
      case 'volume': return symbol in volume ? si / volume[symbol] : NaN;
      case 'temp':
        if (symbol === '°C') return si - 273.15;
        if (symbol === 'K') return si;
        if (symbol === '°F') return (si - 273.15) * 9 / 5 + 32;
        return NaN;
      default: return NaN;
    }
  }

  var Units = { toSI: toSI, fromSI: fromSI, ATM: ATM };
  if (typeof window !== 'undefined') window.Units = Units;
  if (typeof module !== 'undefined' && module.exports) module.exports = Units;
})();
