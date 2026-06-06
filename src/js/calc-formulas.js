/*
 * Формулы калькуляторов. window.CALC['<код>'] принимает входы в СИ и возвращает выходы в СИ.
 * Опирается на window.SteamProps (IAPWS-IF97) и window.PIPE_TABLE (типоразмеры труб).
 * Видимые формулы взяты из formulas/tlv_app_reverse/calculators.json; коэффициент трения и
 * эквивалентные длины фитингов отсутствовали в данных — восстановлены стандартными корреляциями
 * и откалиброваны по эталонным расчётам TLV ToolBox.
 * Конкатенируется в build/js/main.js — без import/export.
 */
(function () {
  'use strict';

  // Глобалы резолвятся лениво (в момент вызова): при конкатенации этот файл идёт раньше
  // calc-steam-if97.js / calc-pipes-data.js, поэтому на этапе загрузки их ещё нет.
  function steam() { return (typeof window !== 'undefined' && window.SteamProps); }
  function pipes() { return (typeof window !== 'undefined' && window.PIPE_TABLE); }

  // Поправочный множитель трения: подгонка под TLV ToolBox (λ_TLV/λ_Колбрук = 1.006,
  // константа по 5 калибровочным точкам, Re 1.3e5..7e5, V 0.095..0.60).
  var FRICTION_CORR = 1.006;

  // Коэффициент трения Дарси по Колбрук-Уайту (итерация) с поправкой. epsd = ε/d.
  function colebrook(Re, epsd) {
    if (Re < 2300) return 64 / Re; // ламинарный режим
    var f = 0.02;
    for (var i = 0; i < 60; i++) {
      f = Math.pow(-2 * Math.log10(epsd / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
    }
    return f * FRICTION_CORR;
  }

  // Коэффициенты местных сопротивлений K (метод TLV: L_eq = n·K·d/f).
  // Откалиброваны по эталонным расчётам TLV ToolBox (классические значения Crane).
  var K = { obsFlo: 10.5, thruFlo: 0.20, check: 2.40, elbow: 1.00 };
  function fittingsLength(d, f, fit) {
    fit = fit || {};
    var sumK = K.obsFlo * (fit.obsFlo || 0) + K.thruFlo * (fit.thruFlo || 0) +
      K.check * (fit.check || 0) + K.elbow * (fit.elbow || 0);
    return sumK * d / f; // эквивалентная длина фитингов, м
  }

  // Удельный объём пара V (м³/кг) и температура T (К): насыщение либо перегрев.
  function steamState(Pabs, Tk) {
    var S = steam(), Ts = S.Tsat(Pabs);
    if (Tk && Tk > Ts + 0.1) return { V: S.superheated(Pabs, Tk).v, T: Tk };
    return { V: S.satVapor(Pabs).v, T: Ts };
  }

  // Гидравлика для известной скорости v (м/с): Re, трение, эквивалентная длина, потери давления.
  // Универсально для любого флюида (V=уд. объём=1/ρ, eta=динам. вязкость Па·с).
  function hydraulics(d, v, V, eta, pipeLen, fit, eps) {
    var Re = v * d / (V * eta);
    var lam = colebrook(Re, eps / d);
    var leq = pipeLen + fittingsLength(d, lam, fit);
    var dp = lam * leq * v * v / (2 * d * V); // Па
    return { v: v, dp: dp, lam: lam, Re: Re, leq: leq };
  }
  // Скорость по массовому расходу (кг/ч) + потери (для пара).
  function velAndLoss(d, ms, V, eta, pipeLen, fit, eps) {
    var v = ms / 3600 * V / (Math.pow(d / 2, 2) * Math.PI);
    return hydraulics(d, v, V, eta, pipeLen, fit, eps);
  }
  function pipeArea(d) { return Math.pow(d / 2, 2) * Math.PI; }

  // ---- Свойства воды и газов ----
  // Удельный объём воды V (м³/кг) по T(К), p(МПа) — из IAPWS-IF97 область 1.
  function waterV(Pabs, Tk) { return steam().region1(Pabs, Tk).v; }
  // Динамическая вязкость воды (Па·с) по T(К). Корреляция 2.414e-5·10^(247.8/(T-140)).
  function waterVisc(Tk) { return 2.414e-5 * Math.pow(10, 247.8 / (Tk - 140)); }
  // Плотность воздуха (кг/м³): идеальный газ, R_возд=287.05 Дж/(кг·К). P в Па.
  function airRho(Ppa, Tk) { return Ppa / (287.05 * Tk); }
  // Динамическая вязкость воздуха (Па·с) — формула Сазерленда.
  function airVisc(Tk) { return 1.716e-5 * Math.pow(Tk / 273.15, 1.5) * (273.15 + 110.4) / (Tk + 110.4); }
  // Плотность произвольного газа (кг/м³): ρ=P·M/(R·T), M г/моль, P в Па.
  function gasRho(Ppa, Mgmol, Tk) { return Ppa * (Mgmol / 1000) / (8.31446 * Tk); }

  var CALC = {};

  /*
   * 11110 — Расчёт размера трубы по допустимым потерям давления (пар).
   * Вход (СИ): pipeGrade(idx), stmPress(МПа абс), stmTemp(К|null), stmFlow(кг/ч),
   *            allowPressLoss(Па), pipeLen(м), fittings{obsFlo,thruFlo,check,elbow}, pipeRough(м).
   * Выход (СИ): pipeSize(label), pipeInDiam(м), stmVelo(м/с), pressLoss(Па), equivLen(м), exceeded(bool).
   */
  CALC['11110'] = function (inp) {
    var S = steam(), PIPES = pipes();
    var st = steamState(inp.stmPress, inp.stmTemp);
    var V = st.V, eta = S.viscosity(1 / V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var list = PIPES[inp.pipeGrade] || PIPES[7];
    var chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000; // мм -> м
      var r = velAndLoss(d, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps);
      if (r.dp <= inp.allowPressLoss) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { // ни одна труба не проходит — берём наибольшую
      var last = list[list.length - 1], dd = last.id / 1000;
      chosen = { pipe: last, d: dd, r: velAndLoss(dd, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps) };
      exceeded = true;
    }
    return {
      pipeSize: formatSize(inp.pipeGrade, chosen.pipe),
      pipeInDiam: chosen.d,            // м
      stmVelo: chosen.r.v,             // м/с
      pressLoss: chosen.r.dp,          // Па
      equivLen: chosen.r.leq,          // м
      exceeded: exceeded
    };
  };

  /*
   * 11150 — Скорость пара в трубе заданного диаметра.
   * Вход: pipeInDiam(м), stmPress(МПа абс), stmTemp(К|null), stmFlow(кг/ч). Выход: stmVelo(м/с).
   */
  CALC['11150'] = function (inp) {
    var V = steamState(inp.stmPress, inp.stmTemp).V;
    return { stmVelo: inp.stmFlow / 3600 * V / (Math.pow(inp.pipeInDiam / 2, 2) * Math.PI) };
  };

  /*
   * 11160 — Расход пара по скорости в трубе заданного диаметра.
   * Вход: pipeInDiam(м), stmPress, stmTemp, stmVelo(м/с). Выход: stmFlow(кг/ч).
   */
  CALC['11160'] = function (inp) {
    var V = steamState(inp.stmPress, inp.stmTemp).V;
    return { stmFlow: inp.stmVelo * Math.pow(inp.pipeInDiam / 2, 2) * Math.PI / V * 3600 };
  };

  /*
   * 11140 — Скорость и потери давления для трубы ЗАДАННОГО диаметра.
   * Вход: pipeInDiam(м), stmPress, stmTemp, stmFlow(кг/ч), pipeLen(м), fittings, pipeRough(м).
   * Выход: stmVelo(м/с), pressLoss(Па), equivLen(м).
   */
  CALC['11140'] = function (inp) {
    var S = steam();
    var st = steamState(inp.stmPress, inp.stmTemp);
    var eta = S.viscosity(1 / st.V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var r = velAndLoss(inp.pipeInDiam, inp.stmFlow, st.V, eta, inp.pipeLen, inp.fittings, eps);
    return { stmVelo: r.v, pressLoss: r.dp, equivLen: r.leq };
  };

  /*
   * 11120 — Подбор размера трубы по допустимой скорости пара.
   * Вход: pipeGrade(idx), stmPress, stmTemp, stmFlow, upperVelo(м/с), pipeLen, fittings, pipeRough.
   * Выход: pipeSize, pipeInDiam(м), stmVelo, pressLoss(Па), equivLen(м), exceeded.
   */
  CALC['11120'] = function (inp) {
    var S = steam(), PIPES = pipes();
    var st = steamState(inp.stmPress, inp.stmTemp), V = st.V;
    var eta = S.viscosity(1 / V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var list = PIPES[inp.pipeGrade] || PIPES[7];
    var chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000;
      var r = velAndLoss(d, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps);
      if (r.v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { // даже наибольшая труба не укладывается в допустимую скорость
      var last = list[list.length - 1], dd = last.id / 1000;
      chosen = { pipe: last, d: dd, r: velAndLoss(dd, inp.stmFlow, V, eta, inp.pipeLen, inp.fittings, eps) };
      exceeded = true;
    }
    return {
      pipeSize: formatSize(inp.pipeGrade, chosen.pipe),
      pipeInDiam: chosen.d, stmVelo: chosen.r.v, pressLoss: chosen.r.dp,
      equivLen: chosen.r.leq, exceeded: exceeded
    };
  };

  // ----- Клапаны и сопла (методика IEC 60534 для сжимаемого потока) -----
  // FXT = Fγ·xT — откалибровано по TLV (Fγ≈1.010, xT=0.72). Расход в кг/ч при p в кПа, ρ в кг/м³.
  var FXT = 0.7275;
  // Массовый расход пара (кг/ч) через клапан с пропускной способностью Cv(US).
  function valveSteamFlow(Cv, p1kPa, p2kPa, rho) {
    var dp = p1kPa - p2kPa; if (dp < 0) dp = 0;
    var x = dp / p1kPa;
    if (x < FXT) return 2.73 * Cv * (1 - x / (3 * FXT)) * Math.sqrt(dp * rho); // докритический
    return (2 / 3) * 2.73 * Cv * Math.sqrt(FXT * p1kPa * rho);                 // запертый поток
  }
  function steamDensity(Pabs, Tk) { return 1 / steamState(Pabs, Tk).V; }

  /*
   * 11210 — Расход пара через клапан по Cv.
   * Вход: stmPrimPress(МПа абс), stmSecondPress(МПа абс), cvValue(Cv US), stmTemp(К|null). Выход: stmFlow(кг/ч).
   */
  CALC['11210'] = function (inp) {
    var rho = steamDensity(inp.stmPrimPress, inp.stmTemp);
    return { stmFlow: valveSteamFlow(inp.cvValue, inp.stmPrimPress * 1000, inp.stmSecondPress * 1000, rho) };
  };

  /*
   * 11220 — Пропускная способность Cv по расходу пара (обратная 11210; расход линеен по Cv).
   * Вход: stmPrimPress, stmSecondPress, stmFlow(кг/ч), stmTemp. Выход: cvValue(Cv US).
   */
  CALC['11220'] = function (inp) {
    var rho = steamDensity(inp.stmPrimPress, inp.stmTemp);
    var per = valveSteamFlow(1, inp.stmPrimPress * 1000, inp.stmSecondPress * 1000, rho);
    return { cvValue: per > 0 ? inp.stmFlow / per : NaN };
  };

  /*
   * 11230 — Расход пара через сопло/орифис. Эквивалент Cv = C·(do/4.654)², do в мм.
   * Вход: stmPrimPress, stmSecondPress, orificeDiam(м), dischargeCoeff(C), stmTemp. Выход: stmFlow(кг/ч).
   */
  CALC['11230'] = function (inp) {
    var rho = steamDensity(inp.stmPrimPress, inp.stmTemp);
    var doMm = inp.orificeDiam * 1000;
    var C = (inp.dischargeCoeff != null && !isNaN(inp.dischargeCoeff)) ? inp.dischargeCoeff : 0.70; // дефолт TLV
    var CvEq = C * Math.pow(doMm / 4.654, 2);
    return { stmFlow: valveSteamFlow(CvEq, inp.stmPrimPress * 1000, inp.stmSecondPress * 1000, rho) };
  };

  // ----- Расход конденсата -----
  // ΔH — теплота, отдаваемая паром конденсату (кДж/кг): энтальпия пара минус насыщенной воды при Ps.
  function enthDiff(Pabs, Tk) {
    var S = steam(), Ts = S.Tsat(Pabs), hf = S.satLiquid(Pabs).h;
    var hg = (Tk && Tk > Ts + 0.1) ? S.superheated(Pabs, Tk).h : S.satVapor(Pabs).h;
    return hg - hf;
  }

  /*
   * 11330 — Расход конденсата при непрерывном нагреве жидкости.
   * Вход: gravity(SG), specHeat(кДж/кг·К), lqdFlow(м³/ч), lqdInTemp(К), lqdOutTemp(К), stmPress(МПа), stmTemp(К).
   * Выход: condLoad(кг/ч).
   */
  CALC['11330'] = function (inp) {
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    return { condLoad: inp.specHeat * inp.gravity * inp.lqdFlow * (inp.lqdOutTemp - inp.lqdInTemp) / dH * 1000 };
  };

  /*
   * 11331 — Конденсат при периодическом нагреве жидкости (фиксированный объём за время).
   * Вход: ..., lqdAmount(м³), heatTime(ч). Выход: totalAmount(кг), aveAmount(кг/ч).
   */
  CALC['11331'] = function (inp) {
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    var total = inp.specHeat * inp.gravity * inp.lqdAmount * (inp.lqdOutTemp - inp.lqdInTemp) / dH * 1000;
    return { totalAmount: total, aveAmount: inp.heatTime > 0 ? total / inp.heatTime : NaN };
  };

  /*
   * 11340 — Расход конденсата при нагреве воздуха (давление атмосферное).
   * ca·γa — теплоёмкость·плотность воздуха (откалибровано по TLV). Qa в м³/ч (после конверсии из м³/мин).
   * Вход: stmPress, stmTemp, airFlow(м³/ч), airInTemp(К), airOutTemp(К). Выход: condLoad(кг/ч).
   */
  var AIR_CA_GAMMA = 1.209; // ca·γa, кДж/(м³·К) — калибровка по TLV (ca≈1.005, γa≈1.203 при 20°C)
  CALC['11340'] = function (inp) {
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    return { condLoad: AIR_CA_GAMMA * inp.airFlow * (inp.airOutTemp - inp.airInTemp) / dH };
  };

  /*
   * 12310 — Образование выпара (flash steam) при дросселировании конденсата.
   * Вход: condPress(МПа абс), condFlow(кг/ч), recoveryPress(МПа абс). Выход: flashRatio(%), flashFlow(кг/ч).
   */
  CALC['12310'] = function (inp) {
    var S = steam();
    var hw = S.satLiquid(inp.condPress).h;       // энтальпия насыщ. воды при давлении конденсата
    var hc = S.satLiquid(inp.recoveryPress).h;   // при давлении вторичного пара
    var hfg = S.latentHeat(inp.recoveryPress);
    var Rfs = (hw - hc) / hfg * 100;
    return { flashRatio: Rfs, flashFlow: Rfs / 100 * inp.condFlow };
  };

  /*
   * 11510 — Свойства насыщенного пара по давлению. Вход: stmPress(МПа абс).
   * Выход (СИ): satTemp(К), latentHeat(кДж/кг), satVapEnth(кДж/кг), satWtrEnth(кДж/кг),
   *             satVapVol(м³/кг), satWtrVol(м³/кг).
   */
  CALC['11510'] = function (inp) {
    var S = steam(), P = inp.stmPress;
    return {
      satTemp: S.Tsat(P), latentHeat: S.latentHeat(P),
      satVapEnth: S.satVapor(P).h, satWtrEnth: S.satLiquid(P).h,
      satVapVol: S.satVapor(P).v, satWtrVol: S.satLiquid(P).v
    };
  };

  /*
   * 11520 — Свойства насыщенного пара по температуре. Вход: stmTemp(К).
   * Выход: stmPress(МПа абс), latentHeat, satVapEnth, satWtrEnth, satVapVol, satWtrVol.
   */
  CALC['11520'] = function (inp) {
    var S = steam(), P = S.Psat(inp.stmTemp);
    return {
      stmPress: P, latentHeat: S.latentHeat(P),
      satVapEnth: S.satVapor(P).h, satWtrEnth: S.satLiquid(P).h,
      satVapVol: S.satVapor(P).v, satWtrVol: S.satLiquid(P).v
    };
  };

  /*
   * 11530 — Свойства перегретого пара. Вход: stmPress(МПа абс), stmTemp(К).
   * Выход: superEnth(кДж/кг), superVol(м³/кг), superCp(кДж/кг·К), superVisc(мПа·с).
   */
  CALC['11530'] = function (inp) {
    var S = steam(), st = S.superheated(inp.stmPress, inp.stmTemp);
    return {
      superEnth: st.h, superVol: st.v, superCp: S.cpSuperheated(inp.stmPress, inp.stmTemp),
      superVisc: S.viscosity(1 / st.v, inp.stmTemp) * 1000 // Па·с -> мПа·с
    };
  };

  // ----- Теплопотери через изоляцию (11320) -----
  // Коэффициент теплоотдачи с поверхности α(W/м²·К) от скорости ветра (калибровка по TLV).
  function alphaSurface(v) { return 13.06 + 5.954 * Math.pow(v < 0 ? 0 : v, 0.6); }
  // Теплопроводность изоляции λ(W/м·К) = λ0 + k·Tmean(°C). Калибровка по TLV (значения JIS).
  // Индекс = value селекта изоляции: 0 минвата Rockwool, 1 стекловата, 2 силикат кальция, 3 перлит.
  var INS_LAMBDA = [
    { l0: 0.03541, k: 1.325e-4 }, // Rockwool
    { l0: 0.02854, k: 1.846e-4 }, // стекловата
    { l0: 0.04085, k: 1.217e-4 }, // силикат кальция
    { l0: 0.06313, k: 1.227e-4 }  // перлит
  ];

  /*
   * 11320 — Теплопотери через изолированную трубу (насыщенный пар).
   * Вход: pipeOutDiam(d1,м), insType(idx), stmPress(МПа абс), windVelo(м/с),
   *       insThick(L,м), pipeLen(l,м), ambTemp(К). Выход: condLoad(кг/ч), radiantHeat(Вт, всего).
   */
  CALC['11320'] = function (inp) {
    var S = steam();
    var Ts = S.Tsat(inp.stmPress) - 273.15;          // °C
    var Tam = inp.ambTemp - 273.15;                   // °C
    var dH = S.latentHeat(inp.stmPress);
    var d1 = inp.pipeOutDiam, L = inp.insThick, D = d1 + 2 * L;
    var lnR = Math.log(D / d1);
    var alpha = alphaSurface(inp.windVelo);
    var ins = INS_LAMBDA[inp.insType] || INS_LAMBDA[0];
    var Tmean = Ts, Qr = 0;
    for (var i = 0; i < 12; i++) {                    // итерация λ↔Tmean
      var lam = ins.l0 + ins.k * Tmean;
      Qr = 2 * Math.PI * (Ts - Tam) / (lnR / lam + 2 / (D * alpha)); // Вт/м
      var Tsurf = Tam + Qr / (Math.PI * D * alpha);
      Tmean = (Ts + Tsurf) / 2;
    }
    var mc = 3.6 * Qr / dH * inp.pipeLen;             // кг/ч
    return { condLoad: mc, radiantHeat: Qr * inp.pipeLen }; // тепло — всего (Вт)
  };

  /*
   * 11310 — Расход конденсата на прогрев трубопровода при запуске (насыщенный пар).
   * mh = cp·Wp·l·(Ts-Tam)/ΔH  (теплоёмкость металла трубы),
   * mr — лучистые потери за время прогрева tSU при средней температуре прогрева (Ts+100)/2.
   * Вход: pipeOutDiam(d1,м), pipeInDiam(м), insType(idx), stmPress(МПа абс), stmTemp(К|null),
   *       windVelo(м/с), insThick(L,м), pipeLen(l,м), ambTemp(К), startTime(ч). Калибровано по TLV.
   * Выход: condHeatPipe(mh,кг), condRadiant(mr,кг), condTotal(mc,кг).
   */
  var CP_STEEL = 0.51, RHO_STEEL = 7850; // кДж/кг·К, кг/м³ (калибровка по TLV)
  CALC['11310'] = function (inp) {
    var S = steam();
    var Ts = S.Tsat(inp.stmPress) - 273.15, Tam = inp.ambTemp - 273.15;
    var dH = enthDiff(inp.stmPress, inp.stmTemp);
    var d1 = inp.pipeOutDiam, ID = inp.pipeInDiam, L = inp.insThick, D = d1 + 2 * L;
    // Конденсат на прогрев металла трубы
    var Wp = Math.PI / 4 * (d1 * d1 - ID * ID) * RHO_STEEL; // кг/м
    var mh = CP_STEEL * Wp * inp.pipeLen * (Ts - Tam) / dH;
    // Конденсат от лучистых потерь за время прогрева (λ при средней темп. прогрева)
    var Tw = (Ts + 100) / 2, alpha = alphaSurface(inp.windVelo);
    var ins = INS_LAMBDA[inp.insType] || INS_LAMBDA[0];
    var lnR = Math.log(D / d1), Tmean = Tw, Qrw = 0;
    for (var i = 0; i < 12; i++) {
      var lam = ins.l0 + ins.k * Tmean;
      Qrw = 2 * Math.PI * (Tw - Tam) / (lnR / lam + 2 / (D * alpha));
      Tmean = (Tw + (Tam + Qrw / (Math.PI * D * alpha))) / 2;
    }
    var mr = 3.6 * Qrw * inp.pipeLen * inp.startTime / dH; // startTime в часах
    return { condHeatPipe: mh, condRadiant: mr, condTotal: mh + mr };
  };

  /*
   * 11130 — Подбор размера трубы по скорости (упрощённый: без фитингов).
   * Вход: pipeGrade, stmPress, stmTemp, stmFlow, upperVelo(м/с), pipeLen, pipeRough. Выход: pipeSize, pipeInDiam, stmVelo, pressLoss.
   */
  CALC['11130'] = function (inp) {
    var S = steam(), PIPES = pipes();
    var st = steamState(inp.stmPress, inp.stmTemp), V = st.V, eta = S.viscosity(1 / V, st.T);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000;
      var r = velAndLoss(d, inp.stmFlow, V, eta, inp.pipeLen, {}, eps);
      if (r.v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000; chosen = { pipe: last, d: dd, r: velAndLoss(dd, inp.stmFlow, V, eta, inp.pipeLen, {}, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, stmVelo: chosen.r.v, pressLoss: chosen.r.dp, exceeded: exceeded };
  };

  /*
   * 11350 / 11360 — Точка подтопления (stall point) для теплообменника.
   * S = (Tb − Tm)/(Ts − Tm)·100, где Tm=(T1+T2)/2 — средняя темп. среды, Tb — темп. насыщения
   * при противодавлении. Вход: lqdInTemp/airInTemp(T1,К), lqdOutTemp/airOutTemp(T2,К),
   * stmPress(МПа), stmTemp(К|null), backPress(МПа), oversur(%). Выход: stallPoint(%), stallPointOs(%).
   */
  function stallPoint(inp) {
    var S = steam();
    var Ts = (inp.stmTemp && inp.stmTemp > S.Tsat(inp.stmPress) ? inp.stmTemp : S.Tsat(inp.stmPress)) - 273.15;
    var Tb = S.Tsat(inp.backPress) - 273.15;
    var T1 = inp.t1 - 273.15, T2 = inp.t2 - 273.15, Tm = (T1 + T2) / 2;
    var Sp = (Tb - Tm) / (Ts - Tm) * 100;
    var os = inp.oversur || 0;
    return { stallPoint: Sp, stallPointOs: Sp * (1 + os / 100) }; // Os — с запасом поверхности (предв., калибровать)
  }
  CALC['11350'] = function (inp) { return stallPoint({ t1: inp.lqdInTemp, t2: inp.lqdOutTemp, stmPress: inp.stmPress, stmTemp: inp.stmTemp, backPress: inp.backPress, oversur: inp.oversur }); };
  CALC['11360'] = function (inp) { return stallPoint({ t1: inp.airInTemp, t2: inp.airOutTemp, stmPress: inp.stmPress, stmTemp: inp.stmTemp, backPress: inp.backPress, oversur: inp.oversur }); };

  // ===== ВОДА: клапаны и сопла (13200/13300/13400) =====
  // Несжимаемый поток (IEC 60534). Qw(м³/ч)=0.0865·Cv·√(Δp/SG), p в кПа.
  // Кавитация при Δp ≥ FL²·(p1−FF·Pv): Qw=0.0865·Cv·FL·√((p1−FF·Pv)/SG).
  var WV_FL = 0.9, WATER_PC_KPA = 22064;
  function waterValveFlow(Cv, p1k, p2k, SG, PvK) {
    var FF = 0.96 - 0.28 * Math.sqrt(PvK / WATER_PC_KPA);
    var dpCh = WV_FL * WV_FL * (p1k - FF * PvK), dp = p1k - p2k;
    if (dp < dpCh) return 0.0865 * Cv * Math.sqrt(dp / SG);
    return 0.0865 * Cv * WV_FL * Math.sqrt((p1k - FF * PvK) / SG);
  }
  function waterSG_Pv(Pabs, Tk) {
    var S = steam();
    return { SG: (1 / S.region1(Pabs, Tk).v) / 1000, Pv: S.Psat(Tk) * 1000 }; // Pv в кПа
  }
  // 13200 — расход воды через клапан по Cv.
  CALC['13200'] = function (inp) {
    var w = waterSG_Pv(inp.wtrPrimPress, inp.wtrTemp);
    return { wtrFlowRate: waterValveFlow(inp.cvValue, inp.wtrPrimPress * 1000, inp.wtrSecondPress * 1000, w.SG, w.Pv) };
  };
  // 13300 — Cv по расходу воды (обратная 13200, линейна по Cv).
  CALC['13300'] = function (inp) {
    var w = waterSG_Pv(inp.wtrPrimPress, inp.wtrTemp);
    var per = waterValveFlow(1, inp.wtrPrimPress * 1000, inp.wtrSecondPress * 1000, w.SG, w.Pv);
    return { cvValue: per > 0 ? inp.wtrFlowRate / per : NaN };
  };
  // 13400 — расход воды через сопло/орифис. Cv = C·(do/4.654)², do в мм.
  CALC['13400'] = function (inp) {
    var w = waterSG_Pv(inp.wtrPrimPress, inp.wtrTemp);
    var C = (inp.dischargeCoeff != null && !isNaN(inp.dischargeCoeff)) ? inp.dischargeCoeff : 0.70;
    var CvEq = C * Math.pow(inp.orificeDiam * 1000 / 4.654, 2);
    return { wtrFlowRate: waterValveFlow(CvEq, inp.wtrPrimPress * 1000, inp.wtrSecondPress * 1000, w.SG, w.Pv) };
  };

  // ===== ВОДА: гидравлика трубопроводов (13110–13150) =====
  // Температура воды по умолчанию (нет ввода на этих страницах) — калибровать по TLV.
  var WATER_T = 293.15; // 20 °C
  function waterProps(Pabs) { var V = waterV(Pabs, WATER_T); return { V: V, eta: waterVisc(WATER_T) }; }

  // 13110 — подбор трубы по допустимым потерям (вода). Qw в м³/ч, pw в МПа абс.
  CALC['13110'] = function (inp) {
    var PIPES = pipes(), wp = waterProps(inp.wtrPress), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var Qs = inp.wtrFlow / 3600, list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs / pipeArea(d);
      var r = hydraulics(d, v, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps);
      if (r.dp <= inp.allowPressLoss) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, wtrVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  };

  // 13120 — подбор трубы по скорости (вода).
  CALC['13120'] = function (inp) {
    var PIPES = pipes(), wp = waterProps(inp.wtrPress || 0.101325), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var Qs = inp.wtrFlow / 3600, list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs / pipeArea(d);
      if (v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: hydraulics(d, v, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps) }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, wtrVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  };

  // 13130 — потери давления и скорость в заданной трубе (вода).
  CALC['13130'] = function (inp) {
    var wp = waterProps(inp.wtrPress || 0.101325), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var v = inp.wtrFlow / 3600 / pipeArea(inp.pipeInDiam);
    var r = hydraulics(inp.pipeInDiam, v, wp.V, wp.eta, inp.pipeLen, inp.fittings, eps);
    return { wtrVelo: r.v, pressLoss: r.dp, equivLen: r.leq };
  };

  // 13140 — скорость воды в трубе. 13150 — расход воды по скорости.
  CALC['13140'] = function (inp) { return { wtrVelo: inp.wtrFlow / 3600 / pipeArea(inp.pipeInDiam) }; };
  CALC['13150'] = function (inp) { return { wtrFlowRate: inp.wtrVelo * pipeArea(inp.pipeInDiam) * 3600 }; };

  // ===== ВОЗДУХ / ГАЗ: гидравлика (14110–14160) =====
  // Состояние воздуха: V(м³/кг), eta(Па·с). Pabs в МПа.
  function airState(Pabs, Tk) { var rho = airRho(Pabs * 1e6, Tk); return { V: 1 / rho, eta: airVisc(Tk) }; }
  // Приведённый (нормальный) объёмный расход из фактического: Qn = Qa·(Pabs/0.101325)·(273.15/T).
  function normalFlow(Qactual, Pabs, Tk) { return Qactual * (Pabs / 0.101325) * (273.15 / Tk); }

  function airSizeBy(inp, byVelo) {
    var PIPES = pipes(), st = airState(inp.airPress, inp.airTemp);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var Qs = inp.airFlow / 3600, list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs / pipeArea(d);
      var r = hydraulics(d, v, st.V, st.eta, inp.pipeLen, inp.fittings, eps);
      var ok = byVelo ? (v <= inp.upperVelo) : (r.dp <= inp.allowPressLoss);
      if (ok) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, st.V, st.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, airVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  }
  CALC['14110'] = function (inp) { return airSizeBy(inp, false); };
  CALC['14120'] = function (inp) { return airSizeBy(inp, true); };
  CALC['14130'] = function (inp) {
    var st = airState(inp.airPress, inp.airTemp), eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var v = inp.airFlow / 3600 / pipeArea(inp.pipeInDiam);
    var r = hydraulics(inp.pipeInDiam, v, st.V, st.eta, inp.pipeLen, inp.fittings, eps);
    return { airVelo: r.v, pressLoss: r.dp, equivLen: r.leq };
  };
  // 14140 — газ: ρ из мол. массы, вязкость задаётся пользователем (мПа·с).
  CALC['14140'] = function (inp) {
    var V = 1 / gasRho(inp.gasPress * 1e6, inp.molecular, inp.gasTemp), eta = inp.gasVisc / 1000; // мПа·с->Па·с
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3;
    var v = inp.gasFlow / 3600 / pipeArea(inp.pipeInDiam);
    var r = hydraulics(inp.pipeInDiam, v, V, eta, inp.pipeLen, inp.fittings, eps);
    return { gasVelo: r.v, pressLoss: r.dp, equivLen: r.leq };
  };
  // 14150 — скорость воздуха. 14160 — расход воздуха (фактический + приведённый).
  CALC['14150'] = function (inp) { return { airVelo: inp.airFlow / 3600 / pipeArea(inp.pipeInDiam) }; };
  CALC['14160'] = function (inp) {
    var Qa = inp.airVelo * pipeArea(inp.pipeInDiam) * 3600; // м³/ч факт.
    return { airFlowRate: Qa, airFlowRateN: normalFlow(Qa, inp.airPress, inp.airTemp) };
  };

  // ===== ВОЗДУХ: клапаны и сопла (14200/14300/14400) =====
  // Сжимаемый поток, константа 4.17 (vs 2.73 для пара). Qa в Nм³/ч. p в кПа абс.
  var AIR_FXT = 0.72; // Fγ·xT для воздуха (Fγ=1.0, xT=0.72) — сверено с TLV
  function airValveFlowN(Cv, p1k, p2k, Tk) {
    var dp = p1k - p2k; if (dp < 0) dp = 0;
    var x = dp / p1k;
    // формула TLV даёт Nм³/мин (с /60); SI=Nм³/ч => ·60, факторы сокращаются
    if (x < AIR_FXT) return 4.17 * Cv * p1k * (1 - x / (3 * AIR_FXT)) * Math.sqrt(x / Tk);
    return (2 / 3) * 4.17 * Cv * p1k * Math.sqrt(AIR_FXT / Tk);
  }
  CALC['14200'] = function (inp) {
    return { airFlowRateN: airValveFlowN(inp.cvValue, inp.airPrimPress * 1000, inp.airSecondPress * 1000, inp.airTemp) };
  };
  CALC['14300'] = function (inp) {
    var per = airValveFlowN(1, inp.airPrimPress * 1000, inp.airSecondPress * 1000, inp.airTemp);
    return { cvValue: per > 0 ? inp.airFlowRateN / per : NaN };
  };
  CALC['14400'] = function (inp) {
    var C = (inp.dischargeCoeff != null && !isNaN(inp.dischargeCoeff)) ? inp.dischargeCoeff : 0.70;
    var CvEq = C * Math.pow(inp.orificeDiam * 1000 / 4.654, 2);
    return { airFlowRateN: airValveFlowN(CvEq, inp.airPrimPress * 1000, inp.airSecondPress * 1000, inp.airTemp) };
  };

  // ===== КОТЁЛ, СТОИМОСТЬ, СУХОСТЬ, ПАРОВОЗДУШНАЯ СМЕСЬ (114xx) =====
  // Энтальпия питательной/сырой воды (кДж/кг) при T(К): насыщенная вода ~ region1 при низком p.
  function waterEnth(Tk) { return steam().region1(0.101325, Tk).h; }

  // 11410 — КПД котла и коэффициент нагрузки.
  CALC['11410'] = function (inp) {
    var S = steam(), P = inp.boilerPress, mb = inp.boilerBlow || 0;
    var hw = S.satLiquid(P).h, dH = S.latentHeat(P), hfw = waterEnth(inp.feedWtrTemp);
    var eff = (inp.feedWtrRate - mb) * (hw + 0.98 * dH - hfw) / (inp.fuelConsumption * inp.fuelCalVal) * 100;
    var lf = (inp.feedWtrRate - mb) / inp.boilerCapa * 100;
    return { boilerEff: eff, loadFactor: lf };
  };
  // 11420 — стоимость единицы энергии. Ce=Cf/(Hf·η/100). Cf $/т, Hf кДж/кг → Ce $/МДж.
  CALC['11420'] = function (inp) {
    return { energyUnitCost: inp.fuelUnitCost / (inp.fuelCalVal * inp.boilerEff / 100) };
  };
  // 11430 — стоимость пара. Cs=(hs−hfw)·Ce. $/т.
  CALC['11430'] = function (inp) {
    var st = steamState(inp.stmPress, inp.stmTemp);
    var hs = inp.stmTemp && inp.stmTemp > steam().Tsat(inp.stmPress) ? steam().superheated(inp.stmPress, inp.stmTemp).h : steam().satVapor(inp.stmPress).h;
    var hfw = waterEnth(inp.feedWtrTemp);
    return { stmCost: (hs - hfw) * inp.energyUnitCost };
  };

  // Сухость/перегрев пара после дросселирования с p1(сухость X1%) до p2.
  function drynessAfter(P1, X1, P2) {
    var S = steam();
    var h1 = S.satVapor(P1).h - (1 - X1 / 100) * S.latentHeat(P1); // энтальпия влажного пара при p1
    var hg2 = S.satVapor(P2).h, Ts2 = S.Tsat(P2);
    if (h1 < hg2) { // остался влажным
      return { secDryness: (1 - (hg2 - h1) / S.latentHeat(P2)) * 100, degreeOfSuper: 0, satTemp: Ts2 };
    }
    // перегрет: ΔT = (h1 − hg2)/cp (cp при насыщении на p2) — как в TLV
    return { secDryness: 100, degreeOfSuper: (h1 - hg2) / S.cpSuperheated(P2, Ts2), satTemp: Ts2 };
  }
  // 11440 — улучшение сухости после редуцирования.
  CALC['11440'] = function (inp) {
    var r = drynessAfter(inp.stmPrimPress, inp.estPrimStmDry, inp.stmSecondPress);
    return { secDryness: r.secDryness, degreeOfSuper: r.degreeOfSuper, satTemp: r.satTemp };
  };
  // 11450 — сухость после редуцирования и сепаратора.
  CALC['11450'] = function (inp) {
    var ms = inp.stmFlow, mc = inp.sepaCond, eta = inp.separateEff;
    var X1 = (1 - mc / (ms * eta / 100)) * 100;            // оценочная первичная сухость
    var Xp1 = (ms - mc / (eta / 100)) / (ms - mc) * 100;   // сухость после сепаратора
    var r = drynessAfter(inp.stmPrimPress, Xp1, inp.stmSecondPress);
    return { estPrimStmDry: X1, secDryness: r.secDryness, degreeOfSuper: r.degreeOfSuper, satTemp: r.satTemp };
  };

  // 11460 — паровоздушная смесь: по доле воздуха → падение температуры.
  CALC['11460'] = function (inp) {
    var S = steam(), p = inp.stmPress, ps = p * (1 - inp.airVolume / 100);
    var Tm = S.Tsat(ps), Tsat = S.Tsat(p);
    return { tempOfMix: Tm, partPress: ps, satTemp: Tsat, tempDrop: Tsat - Tm };
  };
  // 11461 — паровоздушная смесь: по температуре смеси → доля воздуха.
  CALC['11461'] = function (inp) {
    var S = steam(), p = inp.stmPress, ps = S.Psat(inp.tempOfMix);
    var Tsat = S.Tsat(p);
    return { airVolume: (1 - ps / p) * 100, partPress: ps, satTemp: Tsat, tempDrop: Tsat - inp.tempOfMix };
  };

  // ===== КОНДЕНСАТОПРОВОДЫ (12210/12220/12221/12230) =====
  // Двухфазный удельный объём конденсата после вскипания с Cp до Rp.
  function condTwoPhase(CpAbs, RpAbs) {
    var S = steam();
    var Rfs = (S.satLiquid(CpAbs).h - S.satLiquid(RpAbs).h) / S.latentHeat(RpAbs);
    if (Rfs < 0) Rfs = 0;
    var vf = S.satLiquid(RpAbs).v, vg = S.satVapor(RpAbs).v;
    var Vtemp = vf + Rfs * (vg - vf);
    var eta = waterVisc(S.Tsat(RpAbs)); // эфф. вязкость двухфазного потока ≈ насыщ. вода при Rp
    return { V: Vtemp, eta: eta, Rfs: Rfs };
  }
  // 12220 — подбор конденсатопровода по допустимым потерям давления.
  CALC['12220'] = function (inp) {
    var PIPES = pipes(), tp = condTwoPhase(inp.condPress, inp.recoveryPress);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3, Qs = inp.condFlow / 3600;
    var list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs * tp.V / pipeArea(d);
      var r = hydraulics(d, v, tp.V, tp.eta, inp.pipeLen, inp.fittings, eps);
      if (r.dp <= inp.allowPressLoss) { chosen = { pipe: list[i], d: d, r: r }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs * tp.V / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, tp.V, tp.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, condVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  };
  // 12221 — подбор конденсатопровода по допустимой скорости.
  CALC['12221'] = function (inp) {
    var PIPES = pipes(), tp = condTwoPhase(inp.condPress, inp.recoveryPress);
    var eps = inp.pipeRough != null ? inp.pipeRough : 0.05e-3, Qs = inp.condFlow / 3600;
    var list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) {
      var d = list[i].id / 1000, v = Qs * tp.V / pipeArea(d);
      if (v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, r: hydraulics(d, v, tp.V, tp.eta, inp.pipeLen, inp.fittings, eps) }; break; }
    }
    var exceeded = false;
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000, vv = Qs * tp.V / pipeArea(dd); chosen = { pipe: last, d: dd, r: hydraulics(dd, vv, tp.V, tp.eta, inp.pipeLen, inp.fittings, eps) }; exceeded = true; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, condVelo: chosen.r.v, pressLoss: chosen.r.dp, equivLen: chosen.r.leq, exceeded: exceeded };
  };
  // 12210/12230 — упрощённый подбор по скорости (конденсат как жидкость, без вскипания).
  function condSimpleSize(inp) {
    var PIPES = pipes(), V = waterV(0.101325 + (inp.condPress || 0), WATER_T), Qs = inp.condFlow / 3600;
    var list = PIPES[inp.pipeGrade] || PIPES[7], chosen = null;
    for (var i = 0; i < list.length; i++) { var d = list[i].id / 1000, v = Qs / pipeArea(d); if (v <= inp.upperVelo) { chosen = { pipe: list[i], d: d, v: v }; break; } }
    if (!chosen) { var last = list[list.length - 1], dd = last.id / 1000; chosen = { pipe: last, d: dd, v: Qs / pipeArea(dd) }; }
    return { pipeSize: formatSize(inp.pipeGrade, chosen.pipe), pipeInDiam: chosen.d, condVelo: chosen.v };
  }
  CALC['12210'] = condSimpleSize;
  CALC['12230'] = condSimpleSize;

  // ===== РЕКУПЕРАЦИЯ ТЕПЛА КОНДЕНСАТА (12110–12140) =====
  // Общие денежные выходы по рекуперированному теплу Hr (Вт). Калибровано по TLV.
  //   recoverValue (×1000 $/год) = 3.6·Hr·h·Ce / 1e6   (Ce в $/МДж)
  //   annFuelSave (кг/год) = 3.6·Hr·h / (Hf·η/100)
  //   fuelConserv (%) = Hr·0.86 / (hs/4.186 − Tfw) / mfw · 100   (hs — энтальпия пара при давл. котла)
  function recoveryEcon(Hr, inp) {
    var S = steam();
    var h = inp.annual, Ce = inp.energyUnitCost, Hf = inp.fuelCalVal, eta = inp.boilerEff;
    var Tfw = inp.feedWtrTemp - 273.15, mfw = inp.feedWtrRate, hs = S.satVapor(inp.stmPress).h;
    return {
      heatRecover: Hr,
      recoverValue: 3.6 * Hr * h * Ce / 1e6,
      annFuelSave: 3.6 * Hr * h / (Hf * eta / 100),
      fuelConserv: Hr * 0.86 / (hs / 4.186 - Tfw) / mfw * 100
    };
  }

  // 12120 — закрытая система возврата конденсата. Tc=Tsat(давл. конденсата).
  CALC['12120'] = function (inp) {
    var Tc = steam().Tsat(inp.condPress) - 273.15, Tfw = inp.feedWtrTemp - 273.15;
    var Hr = (Tc - Tfw) * inp.condFlow / 0.86;
    return recoveryEcon(Hr, inp);
  };

  // 12110 — открытая система (смешение конденсата с питательной водой в баке).
  CALC['12110'] = function (inp) {
    var Tc = steam().Tsat(inp.condPress) - 273.15, Tfw = inp.feedWtrTemp - 273.15;
    var Tfwmax = inp.allowTemp - 273.15, mc = inp.condFlow, mfw = inp.feedWtrRate;
    var Tm = (Tc * mc + (mfw - mc) * Tfw) / mfw;
    var Tfw2, Hr, Hu;
    if (Tm < Tfwmax) { Tfw2 = Tm; Hr = (Tm - Tfw) * mfw / 0.86; Hu = 0; }
    else { Tfw2 = Tfwmax; Hr = (Tfwmax - Tfw) * mfw / 0.86; Hu = (Tm - Tfwmax) * mfw / 0.86; }
    var e = recoveryEcon(Hr, inp);
    e.unrecoverHeat = Hu; e.feedWtrTemp2 = Tfw2 + 273.15; // вернуть в К для вывода через temp
    return e;
  };

  // 12140 — рекуперация выпара (нагрев сырой воды паром вторичного вскипания).
  CALC['12140'] = function (inp) {
    var S = steam();
    var mfs = inp.condFlow * (S.satLiquid(inp.condPress).h - S.satLiquid(inp.flashPress).h) / S.latentHeat(inp.flashPress);
    var Trw = inp.rawWtrTemp - 273.15;
    var Hr = mfs * (S.satVapor(inp.flashPress).h / 4.186 - Trw) / 0.86;
    var e = recoveryEcon(Hr, inp);
    e.flashFlowRate = mfs;
    return e;
  };

  // 12130 — экономический анализ возврата конденсата для теплообменника.
  // Конденсат (mc) при Tsat(давл. конденсата) отдаёт сенсибельное тепло потоку
  // нагреваемой жидкости (Ql). Потолок смешения Tc, фактический выход T2 через
  // температурный КПД ηT. Тепло, переданное жидкости, пересчитывается в массу
  // греющего пара ms = Q/hfg(Ps) и далее в возвращённое (котловое) тепло
  // Hr = ms·(hg(Ps) − hf(Trw)). Калибровано по TLV (T2 точно, Hr ±0.01%).
  CALC['12130'] = function (inp) {
    var S = steam();
    var T1 = inp.lqdInTemp - 273.15;
    var Tcond = S.Tsat(inp.condPress) - 273.15;
    var Cl = inp.gravity * 1000 * inp.lqdFlow * inp.specHeat; // кДж/(ч·К)
    var Tc = T1 + inp.condFlow * 4.19 * (Tcond - T1) / Cl;    // потолок смешения
    var T2 = T1 + (Tc - T1) * inp.tempEff / 100;
    var QlHeat = Cl * (T2 - T1);                              // кДж/ч в жидкость
    var ms = QlHeat / S.latentHeat(inp.stmPress);            // кг/ч греющего пара
    var hfRw = 4.186 * (inp.rawWtrTemp - 273.15);            // энтальпия сырой воды (cp=4.186, как в TLV)
    var Hr = ms * (S.satVapor(inp.stmPress).h - hfRw) / 3.6;  // Вт
    var e = recoveryEcon(Hr, inp);
    e.lqdOutTemp = T2 + 273.15; // в К для вывода через temp
    return e;
  };

  // Подпись типоразмера: для DIN -> "DN80", иначе метрический размер.
  function formatSize(gradeIdx, pipe) {
    if (gradeIdx === 7) return 'DN' + parseInt(pipe.m, 10);
    return pipe.m;
  }

  if (typeof window !== 'undefined') { window.CALC = CALC; window.CALC_helpers = { colebrook: colebrook, velAndLoss: velAndLoss, steamState: steamState }; }
  if (typeof module !== 'undefined' && module.exports) module.exports = { CALC: CALC, colebrook: colebrook, velAndLoss: velAndLoss, steamState: steamState };
})();
